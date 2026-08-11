import "server-only";

import type { Dirent } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";

export type TransferFile = {
  id: string;
  name: string;
  storedName: string;
  size: number;
  type: string;
};

export type TransferManifest = {
  id: string;
  folderName: string;
  createdAt: string;
  expiresAt: string;
  message: string;
  files: TransferFile[];
  views?: number;
  downloads?: number;
};

export type UploadSession = TransferManifest & {
  storageReservationId?: string;
};

export type AdminTransfer = {
  folderName: string;
  id: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "incomplete";
  files: Array<{ id: string | null; name: string; size: number }>;
  totalSize: number;
  viewCount: number;
  downloadCount: number;
};

const SHARED_ROOT = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const TRANSFER_ID_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})--([a-f0-9]{20})$/;
const FILE_ID_PATTERN = /^[a-f0-9]{20}$/;
const STORAGE_RESERVE_BYTES = 5 * 1024 ** 3;
const INCOMPLETE_UPLOAD_MAX_IDLE_MS = 12 * 60 * 60 * 1000;
const STORAGE_RESERVATION_PATTERN = /^[a-f0-9]{32}$/;
const STORAGE_RESERVATION_MAX_IDLE_MS = INCOMPLETE_UPLOAD_MAX_IDLE_MS;

const transferStatUpdates = new Map<string, Promise<boolean>>();
const globalStorageState = globalThis as typeof globalThis & { shareStorageCapacityQueue?: Promise<void> };
globalStorageState.shareStorageCapacityQueue ??= Promise.resolve();

type StorageReservation = {
  id: string;
  remainingBytes: number;
  updatedAt: string;
};

export class InsufficientStorageError extends Error {}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function transferFolder(folderName: string) {
  if (!FOLDER_PATTERN.test(folderName)) throw new Error("Ungültiger Übertragungsordner.");
  return path.join(SHARED_ROOT, folderName);
}

function manifestPath(folderName: string) {
  return path.join(transferFolder(folderName), "manifest.json");
}

function uploadSessionPath(folderName: string) {
  return path.join(transferFolder(folderName), "upload.json");
}

function storageReservationRoot() {
  return path.join(SHARED_ROOT, ".reservations");
}

function storageReservationPath(id: string) {
  if (!STORAGE_RESERVATION_PATTERN.test(id)) throw new Error("Ungültige Speicherreservierung.");
  return path.join(storageReservationRoot(), `${id}.json`);
}

async function withStorageCapacityLock<T>(operation: () => Promise<T>) {
  const previous = globalStorageState.shareStorageCapacityQueue ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  globalStorageState.shareStorageCapacityQueue = queued;
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (globalStorageState.shareStorageCapacityQueue === queued) {
      globalStorageState.shareStorageCapacityQueue = Promise.resolve();
    }
  }
}

export function createFolderName(date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}_${value("hour")}-${value("minute")}-${value("second")}-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function createTransferId(folderName: string) {
  return `${folderName}--${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function sanitizeFileName(name: string) {
  const withoutControlCharacters = Array.from(path.basename(name), (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  ).join("");
  const baseName = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return (baseName || "Datei").slice(0, 180);
}

export function uniqueStoredName(name: string, used: Set<string>) {
  const sanitized = sanitizeFileName(name);
  const extension = path.extname(sanitized);
  const stem = path.basename(sanitized, extension);
  let candidate = sanitized;
  let counter = 2;
  while (used.has(candidate.toLocaleLowerCase("de-DE"))) {
    candidate = `${stem} (${counter})${extension}`;
    counter += 1;
  }
  used.add(candidate.toLocaleLowerCase("de-DE"));
  return candidate;
}

export async function getTransfer(id: string): Promise<TransferManifest | null> {
  const idMatch = TRANSFER_ID_PATTERN.exec(id);
  if (!idMatch) return null;
  try {
    const manifest = JSON.parse(await readFile(manifestPath(idMatch[1]), "utf8")) as TransferManifest;
    return manifest.id === id ? manifest : null;
  } catch {
    return null;
  }
}

export async function getUploadSession(id: string): Promise<UploadSession | null> {
  const idMatch = TRANSFER_ID_PATTERN.exec(id);
  if (!idMatch) return null;
  try {
    const session = JSON.parse(await readFile(uploadSessionPath(idMatch[1]), "utf8")) as UploadSession;
    return session.id === id ? session : null;
  } catch {
    return null;
  }
}

export async function writeUploadSession(session: UploadSession) {
  await writeFile(uploadSessionPath(session.folderName), JSON.stringify(session, null, 2), { encoding: "utf8", flag: "wx" });
}

export async function getUploadFile(transferId: string, fileId: string) {
  if (!FILE_ID_PATTERN.test(fileId)) return null;
  const session = await getUploadSession(transferId);
  if (!session) return null;
  const file = session.files.find((item) => item.id === fileId);
  if (!file) return null;
  const filePath = storedFilePath(session.folderName, file.storedName);
  let uploaded = 0;
  try {
    uploaded = (await stat(filePath)).size;
  } catch {
    // Die Datei wird mit dem ersten Abschnitt angelegt.
  }
  return { session, file, path: filePath, uploaded };
}

export async function getUploadProgress(session: UploadSession) {
  return Promise.all(session.files.map(async (file) => {
    try {
      return { id: file.id, uploaded: (await stat(storedFilePath(session.folderName, file.storedName))).size };
    } catch {
      return { id: file.id, uploaded: 0 };
    }
  }));
}

async function readStorageReservations() {
  const reservationRoot = storageReservationRoot();
  await mkdir(reservationRoot, { recursive: true });
  const entries = await readdir(reservationRoot, { withFileTypes: true });
  const activeIds = new Set<string>();
  let reservedBytes = 0;
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -5);
    if (!STORAGE_RESERVATION_PATTERN.test(id)) continue;
    const reservationFile = storageReservationPath(id);
    try {
      const reservation = JSON.parse(await readFile(reservationFile, "utf8")) as StorageReservation;
      const updatedAt = new Date(reservation.updatedAt).getTime();
      if (reservation.id !== id
        || !Number.isSafeInteger(reservation.remainingBytes)
        || reservation.remainingBytes < 0
        || !Number.isFinite(updatedAt)) {
        await rm(reservationFile, { force: true });
        continue;
      }
      if (now - updatedAt >= STORAGE_RESERVATION_MAX_IDLE_MS) {
        await rm(reservationFile, { force: true });
        continue;
      }
      activeIds.add(id);
      reservedBytes += reservation.remainingBytes;
    } catch {
      await rm(reservationFile, { force: true }).catch(() => undefined);
    }
  }

  return { activeIds, reservedBytes };
}

async function legacyUploadReservationBytes(activeReservationIds: Set<string>) {
  const entries = await readdir(SHARED_ROOT, { withFileTypes: true });
  let reservedBytes = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !FOLDER_PATTERN.test(entry.name)) continue;
    try {
      const session = JSON.parse(await readFile(uploadSessionPath(entry.name), "utf8")) as UploadSession;
      if (session.storageReservationId && activeReservationIds.has(session.storageReservationId)) continue;
      const progress = await getUploadProgress(session);
      reservedBytes += session.files.reduce((sum, file, index) => {
        const remaining = Math.max(0, Number(file.size) - Number(progress[index]?.uploaded || 0));
        return sum + (Number.isSafeInteger(remaining) ? remaining : 0);
      }, 0);
    } catch {
      // Der Ordner ist vollständig oder wurde während der Prüfung entfernt.
    }
  }
  return reservedBytes;
}

async function updateStorageReservation(reservation: StorageReservation) {
  const finalPath = storageReservationPath(reservation.id);
  const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(reservation), { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, finalPath);
}

export async function reserveStorageCapacity(requiredBytes: number) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0) {
    throw new Error("Ungültige Uploadgröße.");
  }

  return withStorageCapacityLock(async () => {
    await mkdir(SHARED_ROOT, { recursive: true });
    const reservations = await readStorageReservations();
    const legacyReservedBytes = await legacyUploadReservationBytes(reservations.activeIds);
    const fileSystem = await statfs(SHARED_ROOT);
    const availableBytes = fileSystem.bavail * fileSystem.bsize;
    const requiredTotal = requiredBytes + reservations.reservedBytes + legacyReservedBytes + STORAGE_RESERVE_BYTES;
    if (!Number.isSafeInteger(requiredTotal) || availableBytes < requiredTotal) {
      throw new InsufficientStorageError("Auf der VPS ist nicht genug freier Speicher für diese Übertragung.");
    }

    const reservation: StorageReservation = {
      id: crypto.randomUUID().replaceAll("-", ""),
      remainingBytes: requiredBytes,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(storageReservationPath(reservation.id), JSON.stringify(reservation), {
      encoding: "utf8",
      flag: "wx",
    });
    return reservation.id;
  });
}

export async function consumeStorageReservation(id: string | undefined, consumedBytes: number) {
  if (!id || !STORAGE_RESERVATION_PATTERN.test(id) || !Number.isSafeInteger(consumedBytes) || consumedBytes <= 0) return;
  await withStorageCapacityLock(async () => {
    try {
      const reservation = JSON.parse(await readFile(storageReservationPath(id), "utf8")) as StorageReservation;
      reservation.remainingBytes = Math.max(0, reservation.remainingBytes - consumedBytes);
      reservation.updatedAt = new Date().toISOString();
      if (reservation.remainingBytes === 0) {
        await rm(storageReservationPath(id), { force: true });
      } else {
        await updateStorageReservation(reservation);
      }
    } catch {
      // Eine fehlende Reservierung wird über die Upload-Sitzung weiterhin berücksichtigt.
    }
  });
}

export async function releaseStorageReservation(id: string | undefined) {
  if (!id || !STORAGE_RESERVATION_PATTERN.test(id)) return;
  await withStorageCapacityLock(async () => {
    await rm(storageReservationPath(id), { force: true });
  });
}

export async function finishUploadSession(session: UploadSession) {
  const progress = await getUploadProgress(session);
  if (progress.some((item, index) => item.uploaded !== session.files[index].size)) {
    throw new Error("Der Upload ist noch nicht vollst\u00e4ndig.");
  }
  const { storageReservationId, ...manifest } = session;
  await writeTransferManifest(manifest);
  await rm(uploadSessionPath(session.folderName), { force: true });
  await releaseStorageReservation(storageReservationId);
}

export async function prepareTransferFolder(folderName: string) {
  await mkdir(SHARED_ROOT, { recursive: true });
  const folder = transferFolder(folderName);
  await mkdir(folder, { recursive: false });
  return folder;
}

export function storedFilePath(folderName: string, storedName: string) {
  if (sanitizeFileName(storedName) !== storedName) throw new Error("Ungültiger Dateiname.");
  return path.join(transferFolder(folderName), storedName);
}

export async function writeTransferManifest(manifest: TransferManifest) {
  const finalManifestPath = manifestPath(manifest.folderName);
  const temporaryManifestPath = `${finalManifestPath}.tmp`;
  await writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
  await rename(temporaryManifestPath, finalManifestPath);
}

export async function incrementTransferStat(id: string, statName: "views" | "downloads") {
  const idMatch = TRANSFER_ID_PATTERN.exec(id);
  if (!idMatch) return false;
  const folderName = idMatch[1];
  const previousUpdate = transferStatUpdates.get(id) ?? Promise.resolve(true);
  const currentUpdate = previousUpdate.catch(() => false).then(async () => {
    try {
      const finalManifestPath = manifestPath(folderName);
      const manifest = JSON.parse(await readFile(finalManifestPath, "utf8")) as TransferManifest;
      if (manifest.id !== id || transferIsExpired(manifest)) return false;
      manifest[statName] = Math.max(0, Number(manifest[statName]) || 0) + 1;
      const temporaryManifestPath = `${finalManifestPath}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryManifestPath, finalManifestPath);
      return true;
    } catch {
      return false;
    }
  });
  transferStatUpdates.set(id, currentUpdate);
  const updated = await currentUpdate;
  if (transferStatUpdates.get(id) === currentUpdate) transferStatUpdates.delete(id);
  return updated;
}

export async function removeTransferFolder(folderName: string) {
  let storageReservationId: string | undefined;
  try {
    const session = JSON.parse(await readFile(uploadSessionPath(folderName), "utf8")) as UploadSession;
    storageReservationId = session.storageReservationId;
  } catch {
    // Vollständige Übertragungen haben keine Upload-Sitzung mehr.
  }
  await rm(transferFolder(folderName), { recursive: true, force: true });
  await releaseStorageReservation(storageReservationId);
}

async function adminTransferFromEntry(entry: Dirent): Promise<AdminTransfer | null> {
  const folderName = entry.name;
  const folder = transferFolder(folderName);
  try {
    let metadata: TransferManifest | UploadSession | null = null;
    let complete = false;

    try {
      metadata = JSON.parse(await readFile(manifestPath(folderName), "utf8")) as TransferManifest;
      complete = true;
    } catch {
      try {
        metadata = JSON.parse(await readFile(uploadSessionPath(folderName), "utf8")) as UploadSession;
      } catch {
        metadata = null;
      }
    }

    const folderStat = await stat(folder);
    if (metadata) {
      const files = await Promise.all(metadata.files.map(async (file) => {
        try {
          return { id: file.id, name: file.name, size: (await stat(storedFilePath(folderName, file.storedName))).size };
        } catch {
          return { id: file.id, name: file.name, size: 0 };
        }
      }));
      const expired = complete && transferIsExpired(metadata);
      return {
        folderName,
        id: complete ? metadata.id : null,
        createdAt: metadata.createdAt || folderStat.birthtime.toISOString(),
        expiresAt: metadata.expiresAt || null,
        status: complete ? (expired ? "expired" : "active") : "incomplete",
        files,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
        viewCount: complete ? Math.max(0, Number(metadata.views) || 0) : 0,
        downloadCount: complete ? Math.max(0, Number(metadata.downloads) || 0) : 0,
      };
    }

    const rawEntries = await readdir(folder, { withFileTypes: true });
    const files = await Promise.all(rawEntries
      .filter((file) => file.isFile() && !file.name.endsWith(".json") && !file.name.endsWith(".tmp"))
      .map(async (file) => ({ id: null, name: file.name, size: (await stat(path.join(folder, file.name))).size })));
    return {
      folderName,
      id: null,
      createdAt: folderStat.birthtime.toISOString(),
      expiresAt: null,
      status: "incomplete",
      files,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      viewCount: 0,
      downloadCount: 0,
    };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export async function listTransfersForAdmin(): Promise<AdminTransfer[]> {
  await mkdir(SHARED_ROOT, { recursive: true });
  const entries = await readdir(SHARED_ROOT, { withFileTypes: true });
  const transfers = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && FOLDER_PATTERN.test(entry.name))
    .map(adminTransferFromEntry));

  return transfers
    .filter((transfer): transfer is AdminTransfer => transfer !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getStoredFile(transferId: string, fileId: string) {
  if (!FILE_ID_PATTERN.test(fileId)) return null;
  const manifest = await getTransfer(transferId);
  if (!manifest) return null;
  const file = manifest.files.find((item) => item.id === fileId);
  if (!file) return null;
  const filePath = path.join(transferFolder(manifest.folderName), file.storedName);
  try {
    const fileStat = await stat(filePath);
    return { path: filePath, size: fileStat.size };
  } catch {
    return null;
  }
}

export function transferIsExpired(manifest: TransferManifest) {
  return new Date(manifest.expiresAt).getTime() <= Date.now();
}

export async function deleteTransfer(manifest: TransferManifest) {
  await rm(transferFolder(manifest.folderName), { recursive: true, force: true });
}

export async function cleanupExpiredTransfers() {
  await mkdir(SHARED_ROOT, { recursive: true });
  const entries = await readdir(SHARED_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !FOLDER_PATTERN.test(entry.name)) continue;
    try {
      let manifest: TransferManifest | null = null;
      try {
        await access(manifestPath(entry.name));
        manifest = JSON.parse(await readFile(manifestPath(entry.name), "utf8")) as TransferManifest;
      } catch {
        // Uploads ohne Manifest sind noch unvollständig oder wurden abgebrochen.
      }

      if (manifest) {
        if (transferIsExpired(manifest)) await deleteTransfer(manifest);
        continue;
      }

      const folder = transferFolder(entry.name);
      const folderStat = await stat(folder);
      const children = await readdir(folder, { withFileTypes: true });
      const childTimes = await Promise.all(children.map(async (child) => {
        try {
          return (await stat(path.join(folder, child.name))).mtimeMs;
        } catch {
          return 0;
        }
      }));
      const newestActivity = Math.max(folderStat.mtimeMs, ...childTimes);
      if (Date.now() - newestActivity >= INCOMPLETE_UPLOAD_MAX_IDLE_MS) {
        await removeTransferFolder(entry.name);
      }
    } catch {
      // Nicht lesbare oder gerade veränderte Ordner werden beim nächsten Lauf erneut geprüft.
    }
  }
}
