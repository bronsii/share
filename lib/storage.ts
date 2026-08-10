import "server-only";

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
};

export type UploadSession = TransferManifest;

export type AdminTransfer = {
  folderName: string;
  id: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "incomplete";
  files: Array<{ id: string | null; name: string; size: number }>;
  totalSize: number;
};

const SHARED_ROOT = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const TRANSFER_ID_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})--([a-f0-9]{20})$/;
const FILE_ID_PATTERN = /^[a-f0-9]{20}$/;
const STORAGE_RESERVE_BYTES = 5 * 1024 ** 3;
const INCOMPLETE_UPLOAD_MAX_IDLE_MS = 12 * 60 * 60 * 1000;

export class InsufficientStorageError extends Error {}

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

export async function finishUploadSession(session: UploadSession) {
  const progress = await getUploadProgress(session);
  if (progress.some((item, index) => item.uploaded !== session.files[index].size)) {
    throw new Error("Der Upload ist noch nicht vollst\u00e4ndig.");
  }
  await writeTransferManifest(session);
  await rm(uploadSessionPath(session.folderName), { force: true });
}

export async function ensureStorageCapacity(requiredBytes: number) {
  await mkdir(SHARED_ROOT, { recursive: true });
  const fileSystem = await statfs(SHARED_ROOT);
  const availableBytes = fileSystem.bavail * fileSystem.bsize;
  if (availableBytes < requiredBytes + STORAGE_RESERVE_BYTES) {
    throw new InsufficientStorageError("Auf der VPS ist nicht genug freier Speicher für diese Übertragung.");
  }
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

export async function removeTransferFolder(folderName: string) {
  await rm(transferFolder(folderName), { recursive: true, force: true });
}

export async function listTransfersForAdmin(): Promise<AdminTransfer[]> {
  await mkdir(SHARED_ROOT, { recursive: true });
  const entries = await readdir(SHARED_ROOT, { withFileTypes: true });
  const transfers = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && FOLDER_PATTERN.test(entry.name))
    .map(async (entry): Promise<AdminTransfer> => {
      const folderName = entry.name;
      const folder = transferFolder(folderName);
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
      };
    }));

  return transfers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
