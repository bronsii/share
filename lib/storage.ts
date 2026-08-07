import "server-only";

import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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

const SHARED_ROOT = "C:\\apps\\share\\shared";
const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const TRANSFER_ID_PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})--([a-f0-9]{20})$/;
const FILE_ID_PATTERN = /^[a-f0-9]{20}$/;

function transferFolder(folderName: string) {
  if (!FOLDER_PATTERN.test(folderName)) throw new Error("Ungültiger Übertragungsordner.");
  return path.join(SHARED_ROOT, folderName);
}

function manifestPath(folderName: string) {
  return path.join(transferFolder(folderName), "manifest.json");
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

export function uniqueStoredNames(files: File[]) {
  const used = new Set<string>();
  return files.map((file) => {
    const sanitized = sanitizeFileName(file.name);
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
  });
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

export async function saveTransfer(manifest: TransferManifest, files: File[]) {
  await mkdir(SHARED_ROOT, { recursive: true });
  const folder = transferFolder(manifest.folderName);
  await mkdir(folder, { recursive: false });
  try {
    for (let index = 0; index < files.length; index += 1) {
      const bytes = Buffer.from(await files[index].arrayBuffer());
      await writeFile(path.join(folder, manifest.files[index].storedName), bytes, { flag: "wx" });
    }
    const finalManifestPath = manifestPath(manifest.folderName);
    const temporaryManifestPath = `${finalManifestPath}.tmp`;
    await writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporaryManifestPath, finalManifestPath);
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
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
      await access(manifestPath(entry.name));
      const manifest = JSON.parse(await readFile(manifestPath(entry.name), "utf8")) as TransferManifest;
      if (transferIsExpired(manifest)) await deleteTransfer(manifest);
    } catch {
      // Unvollständige oder manuell angelegte Ordner bleiben unangetastet.
    }
  }
}
