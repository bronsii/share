import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const sharedRoot = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const folderPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const dryRun = process.argv.includes("--dry-run");
const now = Date.now();
const incompleteMaxIdleMs = 12 * 60 * 60 * 1000;
let deletedExpired = 0;
let deletedIncomplete = 0;

async function newestActivity(folder) {
  const folderStat = await stat(folder);
  const children = await readdir(folder, { withFileTypes: true });
  const childTimes = await Promise.all(children.map(async (entry) => {
    try {
      return (await stat(path.join(folder, entry.name))).mtimeMs;
    } catch {
      return 0;
    }
  }));
  return Math.max(folderStat.mtimeMs, ...childTimes);
}

const entries = await readdir(sharedRoot, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory() || !folderPattern.test(entry.name)) continue;

  const folder = path.join(sharedRoot, entry.name);
  try {
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8"));
    } catch {
      // Uploads ohne Manifest sind noch unvollständig oder wurden abgebrochen.
    }

    if (manifest) {
      const expiresAt = new Date(manifest.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue;

      if (!dryRun) await rm(folder, { recursive: true, force: true });
      deletedExpired += 1;
      console.log(`${dryRun ? "Would delete expired" : "Deleted expired"}: ${entry.name}`);
      continue;
    }

    const idleSince = await newestActivity(folder);
    if (now - idleSince < incompleteMaxIdleMs) continue;

    if (!dryRun) await rm(folder, { recursive: true, force: true });
    deletedIncomplete += 1;
    console.log(`${dryRun ? "Would delete incomplete" : "Deleted incomplete"}: ${entry.name}`);
  } catch (error) {
    console.error(`Skipped ${entry.name}:`, error instanceof Error ? error.message : error);
  }
}

console.log(`${dryRun ? "Expired" : "Deleted"} transfers: ${deletedExpired}`);
console.log(`${dryRun ? "Stale incomplete" : "Deleted incomplete"} uploads: ${deletedIncomplete}`);
