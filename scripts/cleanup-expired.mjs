import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const sharedRoot = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const folderPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;
const dryRun = process.argv.includes("--dry-run");
const now = Date.now();
let deleted = 0;

const entries = await readdir(sharedRoot, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory() || !folderPattern.test(entry.name)) continue;

  const folder = path.join(sharedRoot, entry.name);
  try {
    const manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8"));
    const expiresAt = new Date(manifest.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt > now) continue;

    if (!dryRun) await rm(folder, { recursive: true, force: true });
    deleted += 1;
    console.log(`${dryRun ? "Would delete" : "Deleted"}: ${entry.name}`);
  } catch (error) {
    console.error(`Skipped ${entry.name}:`, error instanceof Error ? error.message : error);
  }
}

console.log(`${dryRun ? "Expired" : "Deleted"} transfers: ${deleted}`);
