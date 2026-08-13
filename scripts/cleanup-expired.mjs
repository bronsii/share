import path from "node:path";
import { cleanupTransfersAtRoot } from "../lib/storage-cleanup.mjs";

const sharedRoot = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const dryRun = process.argv.includes("--dry-run");

const result = await cleanupTransfersAtRoot({
  sharedRoot,
  dryRun,
  onEvent(event) {
    if (event.type === "skipped") {
      console.error(`Skipped ${event.folderName}:`, event.error instanceof Error ? event.error.message : event.error);
      return;
    }
    const label = event.type === "expired" ? "expired" : "incomplete";
    console.log(`${dryRun ? "Would delete" : "Deleted"} ${label}: ${event.folderName}`);
  },
});

console.log(`${dryRun ? "Expired" : "Deleted"} transfers: ${result.expired}`);
console.log(`${dryRun ? "Stale incomplete" : "Deleted incomplete"} uploads: ${result.incomplete}`);
