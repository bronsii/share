import { readFile, readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { INCOMPLETE_UPLOAD_MAX_IDLE_MS } from "./storage-cleanup.mjs";

const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const RESERVATION_PATTERN = /^[a-f0-9]{32}\.json$/;
export const DEFAULT_STORAGE_RESERVE_BYTES = 5 * 1024 ** 3;

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sumBytes(left, right) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new Error("Invalid storage accounting");
  return sum;
}

/** Read-only snapshot: never expires reservations, truncates files or creates directories. */
export async function readStorageSummary({ sharedRoot, now = Date.now(), reserveBytes = DEFAULT_STORAGE_RESERVE_BYTES }) {
  const fileSystem = await statfs(/* turbopackIgnore: true */ sharedRoot);
  const freeBytes = fileSystem.bavail * fileSystem.bsize;
  const totalBytes = fileSystem.blocks * fileSystem.bsize;
  if (![freeBytes, totalBytes, reserveBytes].every((value) => Number.isSafeInteger(value) && value >= 0)
    || totalBytes === 0 || freeBytes > totalBytes) throw new Error("Invalid filesystem capacity");
  const entries = await readdir(/* turbopackIgnore: true */ sharedRoot, { withFileTypes: true });
  const activeIds = new Set();
  let reservedUploadBytes = 0;
  let incompleteUploads = 0;
  let accountingWarnings = 0;
  let reservations = [];
  try {
    reservations = await readdir(/* turbopackIgnore: true */ path.join(sharedRoot, ".reservations"), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of reservations) {
    if (!entry.isFile() || !RESERVATION_PATTERN.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    let reservation;
    try {
      reservation = await readOptionalJson(path.join(sharedRoot, ".reservations", entry.name));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      accountingWarnings += 1;
      continue;
    }
    if (!reservation) continue;
    const updatedAt = Date.parse(reservation.updatedAt);
    if (reservation.id !== id || !Number.isSafeInteger(reservation.remainingBytes) || reservation.remainingBytes < 0
      || !Number.isFinite(updatedAt) || updatedAt > now + 60_000) {
      accountingWarnings += 1;
      continue;
    }
    if (now - updatedAt >= INCOMPLETE_UPLOAD_MAX_IDLE_MS) continue;
    activeIds.add(id);
    reservedUploadBytes = sumBytes(reservedUploadBytes, reservation.remainingBytes);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !FOLDER_PATTERN.test(entry.name)) continue;
    const folder = path.join(sharedRoot, entry.name);
    try {
      const manifest = await readOptionalJson(path.join(folder, "manifest.json"));
      if (manifest) continue;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      accountingWarnings += 1;
    }
    incompleteUploads += 1;
    let session;
    try {
      session = await readOptionalJson(path.join(folder, "upload.json"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      accountingWarnings += 1;
      continue;
    }
    if (!session) continue;
    if (activeIds.has(session.storageReservationId)) continue;
    if (!Array.isArray(session.files)) {
      accountingWarnings += 1;
      continue;
    }
    for (const file of session.files) {
      if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.storedName !== "string"
        || !file.storedName || file.storedName === "." || file.storedName === ".." || /[\\/:\0]/u.test(file.storedName)) {
        accountingWarnings += 1;
        continue;
      }
      let uploaded = 0;
      try {
        uploaded = (await stat(/* turbopackIgnore: true */ path.join(folder, file.storedName))).size;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      // Match resumable encrypted progress without calling its truncating storage helper.
      if (session.encryption && file.plaintextSize && uploaded !== file.size) {
        const cipherChunkSize = session.encryption.chunkSize + 16;
        if (!Number.isSafeInteger(cipherChunkSize) || cipherChunkSize <= 16) {
          accountingWarnings += 1;
          continue;
        }
        uploaded = Math.floor(uploaded / cipherChunkSize) * cipherChunkSize;
      }
      reservedUploadBytes = sumBytes(reservedUploadBytes, Math.max(0, file.size - uploaded));
    }
  }
  const requiredReserve = sumBytes(reserveBytes, reservedUploadBytes);
  return {
    freeBytes,
    totalBytes,
    reservedUploadBytes,
    safetyReserveBytes: reserveBytes,
    availableForUploadsBytes: Math.max(0, freeBytes - requiredReserve),
    incompleteUploads,
    accountingWarnings,
  };
}
