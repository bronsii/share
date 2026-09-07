import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readStorageSummary } from "../lib/operations-storage.mjs";
import { cleanupStatePath, readCleanupSummary, recordScheduledCleanup, DEFAULT_CLEANUP_MAX_AGE_MS } from "../lib/operations-state.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function fixture(context) {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "share-operations-test-"));
  context.after(() => rm(sharedRoot, { recursive: true, force: true }));
  return sharedRoot;
}

test("Operations counts reservations and legacy remaining bytes without changing disk state", async (context) => {
  const sharedRoot = await fixture(context);
  const now = Date.now();
  const activeId = "a".repeat(32);
  const staleId = "b".repeat(32);
  const invalidId = "c".repeat(32);
  await mkdir(path.join(sharedRoot, ".reservations"));
  const reservations = [
    [activeId, { id: activeId, remainingBytes: 100, updatedAt: new Date(now).toISOString() }],
    [staleId, { id: staleId, remainingBytes: 9999, updatedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() }],
    [invalidId, { id: invalidId, remainingBytes: -1, updatedAt: "invalid" }],
  ];
  for (const [id, value] of reservations) await writeFile(path.join(sharedRoot, ".reservations", `${id}.json`), JSON.stringify(value));
  const folders = ["2026-09-07_10-00-00-000", "2026-09-07_10-00-01-000", "2026-09-07_10-00-02-000"];
  for (const folder of folders) await mkdir(path.join(sharedRoot, folder));
  await writeFile(path.join(sharedRoot, folders[0], "upload.json"), JSON.stringify({ storageReservationId: activeId, files: [{ size: 100, storedName: "active.bin" }] }));
  await writeFile(path.join(sharedRoot, folders[1], "upload.json"), JSON.stringify({ storageReservationId: staleId, encryption: { chunkSize: 16 }, files: [{ plaintextSize: 100, size: 100, storedName: "partial.bin" }] }));
  const partialPath = path.join(sharedRoot, folders[1], "partial.bin");
  await writeFile(partialPath, Buffer.alloc(35));
  await writeFile(path.join(sharedRoot, folders[2], "manifest.json"), JSON.stringify({ expiresAt: new Date(now + 60_000).toISOString() }));
  const before = await Promise.all(reservations.map(async ([id]) => readFile(path.join(sharedRoot, ".reservations", `${id}.json`), "utf8")));
  const summary = await readStorageSummary({ sharedRoot, now });
  assert.equal(summary.reservedUploadBytes, 168, "active reservation counted once; encrypted partial rounds down without truncation");
  assert.equal(summary.incompleteUploads, 2);
  assert.equal(summary.accountingWarnings, 1);
  assert.equal(summary.availableForUploadsBytes, Math.max(0, summary.freeBytes - summary.safetyReserveBytes - 168));
  assert.equal((await stat(partialPath)).size, 35);
  assert.deepEqual(await Promise.all(reservations.map(async ([id]) => readFile(path.join(sharedRoot, ".reservations", `${id}.json`), "utf8"))), before);
  assert.equal((await readdir(sharedRoot)).includes(".operations"), false);
});

test("Operations checks fail closed for missing storage and report corrupt metadata without deleting it", async (context) => {
  const sharedRoot = await fixture(context);
  await assert.rejects(readStorageSummary({ sharedRoot: path.join(sharedRoot, "missing") }));
  assert.deepEqual(await readdir(sharedRoot), []);
  const folder = path.join(sharedRoot, "2026-09-07_11-00-00-000");
  await mkdir(folder);
  await writeFile(path.join(folder, "upload.json"), "broken");
  const summary = await readStorageSummary({ sharedRoot });
  assert.equal(summary.incompleteUploads, 1);
  assert.equal(summary.accountingWarnings, 1);
  assert.equal(await readFile(path.join(folder, "upload.json"), "utf8"), "broken");
});

test("Scheduled cleanup shows unknown, successful, stale and failed states while preserving last success", async (context) => {
  const sharedRoot = await fixture(context);
  const now = Date.now();
  assert.equal((await readCleanupSummary({ sharedRoot, now })).status, "unknown");
  await recordScheduledCleanup({ sharedRoot, success: true, result: { expired: 2, incomplete: 3 }, now });
  const success = await readCleanupSummary({ sharedRoot, now });
  assert.equal(success.status, "ok");
  assert.deepEqual(success.lastSuccessCounts, { expired: 2, incomplete: 3 });
  assert.equal((await readCleanupSummary({ sharedRoot, now: now + DEFAULT_CLEANUP_MAX_AGE_MS + 1 })).status, "stale");
  await recordScheduledCleanup({ sharedRoot, success: false, now: now + 1000 });
  const failed = await readCleanupSummary({ sharedRoot, now: now + 1000 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastSuccessAt, success.lastSuccessAt);
  assert.equal(failed.lastAttemptAt, new Date(now + 1000).toISOString());
  assert.deepEqual(await readdir(path.dirname(cleanupStatePath(sharedRoot))), ["cleanup.json"]);
});

test("Corrupt or future cleanup status cannot masquerade as healthy", async (context) => {
  const sharedRoot = await fixture(context);
  const now = Date.now();
  await recordScheduledCleanup({ sharedRoot, success: true, result: { expired: 0, incomplete: 0 }, now: now + 120_000 });
  assert.equal((await readCleanupSummary({ sharedRoot, now })).status, "unavailable");
  await writeFile(cleanupStatePath(sharedRoot), "{broken");
  assert.equal((await readCleanupSummary({ sharedRoot, now })).status, "unavailable");
});

test("Only non-dry-run scheduled CLI executions update the cleanup heartbeat, with aggregate-only logs", async (context) => {
  const sharedRoot = await fixture(context);
  const folderName = "2026-09-07_12-00-00-000";
  await mkdir(path.join(sharedRoot, folderName));
  await writeFile(path.join(sharedRoot, folderName, "manifest.json"), JSON.stringify({ expiresAt: "2020-01-01T00:00:00Z" }));
  const run = (...args) => spawnSync(process.execPath, [path.join(projectRoot, "scripts/cleanup-expired.mjs"), ...args], { cwd: projectRoot, env: { ...process.env, SHARED_ROOT: sharedRoot }, encoding: "utf8" });
  for (const args of [["--dry-run", "--scheduled"], []]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(folderName), false);
    assert.equal((await readCleanupSummary({ sharedRoot })).status, "unknown");
  }
  const scheduled = run("--scheduled");
  assert.equal(scheduled.status, 0, scheduled.stderr);
  assert.equal((await readCleanupSummary({ sharedRoot })).status, "ok");
  const before = await readFile(cleanupStatePath(sharedRoot), "utf8");
  assert.equal(run("--dry-run", "--scheduled").status, 0);
  assert.equal(await readFile(cleanupStatePath(sharedRoot), "utf8"), before);
});

test("Scheduled CLI returns a failure exit code when cleanup cannot run, without logging paths", async (context) => {
  const sharedRoot = await fixture(context);
  const invalidRoot = path.join(sharedRoot, "not-a-directory-private-path");
  await writeFile(invalidRoot, "fixture");
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts/cleanup-expired.mjs"), "--scheduled"], {
    cwd: projectRoot,
    env: { ...process.env, SHARED_ROOT: invalidRoot },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cleanup_failed/u);
  assert.equal((result.stdout + result.stderr).includes(invalidRoot), false);
  assert.equal((result.stdout + result.stderr).includes("fixture"), false);
  assert.equal(await readFile(invalidRoot, "utf8"), "fixture");
});

test("Cleanup summaries return only validated aggregate fields", async (context) => {
  const sharedRoot = await fixture(context);
  await recordScheduledCleanup({ sharedRoot, success: true, result: { expired: 0, incomplete: 1 } });
  const state = JSON.parse(await readFile(cleanupStatePath(sharedRoot), "utf8"));
  await writeFile(cleanupStatePath(sharedRoot), JSON.stringify({ ...state, private: "not-for-api", lastSuccessCounts: { ...state.lastSuccessCounts, private: "not-for-api" } }));
  assert.equal(JSON.stringify(await readCleanupSummary({ sharedRoot })).includes("not-for-api"), false);
});

test("Without a successful cleanup timestamp, counts must be exactly null", async (context) => {
  const sharedRoot = await fixture(context);
  await recordScheduledCleanup({ sharedRoot, success: false });
  const state = JSON.parse(await readFile(cleanupStatePath(sharedRoot), "utf8"));
  const initial = await readCleanupSummary({ sharedRoot });
  assert.equal(initial.status, "failed");
  assert.equal(initial.lastSuccessAt, null);
  assert.equal(initial.lastSuccessCounts, null);
  for (const counts of [{}, "broken", { expired: 0, incomplete: 1 }, undefined]) {
    await writeFile(cleanupStatePath(sharedRoot), JSON.stringify({ ...state, lastSuccessCounts: counts }));
    const summary = await readCleanupSummary({ sharedRoot });
    assert.equal(summary.status, "unavailable");
    assert.equal(summary.lastSuccessAt, null);
    assert.equal(summary.lastSuccessCounts, null);
  }
});
