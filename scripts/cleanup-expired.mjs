import path from "node:path";
import { cleanupTransfersAtRoot } from "../lib/storage-cleanup.mjs";
import { recordScheduledCleanup } from "../lib/operations-state.mjs";

const sharedRoot = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const dryRun = process.argv.includes("--dry-run");
const scheduled = process.argv.includes("--scheduled") && !dryRun;
let skipped = 0;

try {
  const result = await cleanupTransfersAtRoot({
    sharedRoot,
    dryRun,
    onEvent(event) {
      if (event.type === "skipped") skipped += 1;
    },
  });
  const success = skipped === 0;
  if (scheduled) await recordScheduledCleanup({ sharedRoot, success, result });
  // Aggregate-only journald output: no transfer IDs, names, paths or exception details.
  console.log(JSON.stringify({ service: "sendebude-cleanup", dryRun, scheduled, status: success ? "ok" : "failed", ...result, skipped }));
  if (!success) process.exitCode = 1;
} catch {
  if (scheduled) {
    await recordScheduledCleanup({ sharedRoot, success: false }).catch(() => {
      console.error("sendebude-cleanup: cleanup_status_write_failed");
    });
  }
  console.error("sendebude-cleanup: cleanup_failed");
  process.exitCode = 1;
}
