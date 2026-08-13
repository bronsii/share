import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const STORAGE_RESERVATION_PATTERN = /^[a-f0-9]{32}$/;
export const INCOMPLETE_UPLOAD_MAX_IDLE_MS = 2 * 60 * 60 * 1000;

async function newestActivity(folder) {
  const folderStat = await stat(/* turbopackIgnore: true */ folder);
  const children = await readdir(/* turbopackIgnore: true */ folder, { withFileTypes: true });
  const childTimes = await Promise.all(children.map(async (entry) => {
    try {
      return (await stat(/* turbopackIgnore: true */ path.join(folder, entry.name))).mtimeMs;
    } catch {
      return 0;
    }
  }));
  return Math.max(folderStat.mtimeMs, ...childTimes);
}

async function uploadReservationId(folder) {
  try {
    const session = JSON.parse(await readFile(/* turbopackIgnore: true */ path.join(folder, "upload.json"), "utf8"));
    return STORAGE_RESERVATION_PATTERN.test(session.storageReservationId) ? session.storageReservationId : null;
  } catch {
    return null;
  }
}

async function removeIncompleteFolder(sharedRoot, folder, dryRun) {
  if (dryRun) return;
  const reservationId = await uploadReservationId(folder);
  await rm(/* turbopackIgnore: true */ folder, { recursive: true, force: true });
  if (reservationId) {
    await rm(
      /* turbopackIgnore: true */ path.join(sharedRoot, ".reservations", `${reservationId}.json`),
      { force: true },
    );
  }
}

/**
 * @param {{
 *   sharedRoot: string,
 *   dryRun?: boolean,
 *   now?: number,
 *   incompleteMaxIdleMs?: number,
 *   onEvent?: (event: { type: "expired" | "incomplete" | "skipped", folderName: string, error?: unknown }) => void,
 * }} options
 */
export async function cleanupTransfersAtRoot({
  sharedRoot,
  dryRun = false,
  now = Date.now(),
  incompleteMaxIdleMs = INCOMPLETE_UPLOAD_MAX_IDLE_MS,
  onEvent = () => undefined,
}) {
  await mkdir(/* turbopackIgnore: true */ sharedRoot, { recursive: true, mode: 0o700 });
  const entries = await readdir(/* turbopackIgnore: true */ sharedRoot, { withFileTypes: true });
  let expired = 0;
  let incomplete = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !FOLDER_PATTERN.test(entry.name)) continue;
    const folder = path.join(/* turbopackIgnore: true */ sharedRoot, entry.name);
    try {
      let manifest = null;
      try {
        manifest = JSON.parse(await readFile(/* turbopackIgnore: true */ path.join(folder, "manifest.json"), "utf8"));
      } catch {
        // Ordner ohne lesbares Manifest werden als unvollständiger Upload behandelt.
      }

      if (manifest) {
        const expiresAt = new Date(manifest.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt > now) continue;
        if (!dryRun) await rm(/* turbopackIgnore: true */ folder, { recursive: true, force: true });
        expired += 1;
        onEvent({ type: "expired", folderName: entry.name });
        continue;
      }

      if (now - await newestActivity(folder) < incompleteMaxIdleMs) continue;
      await removeIncompleteFolder(sharedRoot, folder, dryRun);
      incomplete += 1;
      onEvent({ type: "incomplete", folderName: entry.name });
    } catch (error) {
      onEvent({ type: "skipped", folderName: entry.name, error });
    }
  }

  return { expired, incomplete };
}
