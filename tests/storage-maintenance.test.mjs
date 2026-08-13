import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sanitizeFileName } from "../lib/file-name.mjs";
import { cleanupTransfersAtRoot, INCOMPLETE_UPLOAD_MAX_IDLE_MS } from "../lib/storage-cleanup.mjs";
import { orderRecoveryFiles, validUploadRecovery } from "../lib/upload-recovery.mjs";

const folders = {
  expired: "2026-08-13_10-00-00-000",
  active: "2026-08-13_10-00-01-000",
  stale: "2026-08-13_10-00-02-000",
  fresh: "2026-08-13_10-00-03-000",
};

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function createFixture(now) {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "share-cleanup-test-"));
  for (const folderName of Object.values(folders)) {
    await mkdir(path.join(sharedRoot, folderName), { mode: 0o700 });
  }
  await writeFile(path.join(sharedRoot, folders.expired, "manifest.json"), JSON.stringify({
    expiresAt: new Date(now - 1).toISOString(),
  }));
  await writeFile(path.join(sharedRoot, folders.active, "manifest.json"), JSON.stringify({
    expiresAt: new Date(now + 60_000).toISOString(),
  }));

  const reservationId = "a".repeat(32);
  await mkdir(path.join(sharedRoot, ".reservations"), { mode: 0o700 });
  await writeFile(path.join(sharedRoot, ".reservations", `${reservationId}.json`), "reserved");
  await writeFile(path.join(sharedRoot, folders.stale, "upload.json"), JSON.stringify({ storageReservationId: reservationId }));
  await writeFile(path.join(sharedRoot, folders.stale, "partial.bin"), "partial");
  await writeFile(path.join(sharedRoot, folders.fresh, "upload.json"), "{}");

  const staleTime = new Date(now - INCOMPLETE_UPLOAD_MAX_IDLE_MS - 1_000);
  await utimes(path.join(sharedRoot, folders.stale, "upload.json"), staleTime, staleTime);
  await utimes(path.join(sharedRoot, folders.stale, "partial.bin"), staleTime, staleTime);
  await utimes(path.join(sharedRoot, folders.stale), staleTime, staleTime);
  return { sharedRoot, reservationId };
}

test("Dateinamenbereinigung ist idempotent", () => {
  for (const name of ["bericht.txt", "  bericht... ", "a".repeat(179) + "...", "<>:\\datei?.txt", "\u0001\u0002"]) {
    const sanitized = sanitizeFileName(name);
    assert.equal(sanitizeFileName(sanitized), sanitized);
    assert.ok(sanitized.length <= 180);
  }
});

test("Upload-Wiederaufnahme akzeptiert ausschließlich dieselben Dateien und stellt die Reihenfolge wieder her", () => {
  const first = { name: "eins.bin", size: 10, lastModified: 100, marker: 1 };
  const second = { name: "zwei.bin", size: 20, lastModified: 200, marker: 2 };
  assert.deepEqual(orderRecoveryFiles([second, first], [first, second]), [first, second]);
  assert.equal(orderRecoveryFiles([{ ...first, size: 11 }, second], [first, second]), null);
  assert.equal(orderRecoveryFiles([first], [first, second]), null);
});

test("Gespeicherte Upload-Wiederaufnahme wird streng validiert", () => {
  const recovery = {
    version: 1,
    session: {
      id: `2026-08-13_10-00-00-000--${"a".repeat(32)}`,
      expiresAt: new Date().toISOString(),
      files: [{ id: "b".repeat(32), name: "Verschlüsselte Datei 1", size: 26, uploaded: 0 }],
    },
    fragment: `v1.${"a".repeat(43)}`,
    noncePrefixes: ["a".repeat(16)],
    files: [{ name: "datei.bin", size: 10, lastModified: 100 }],
    days: "3",
    message: "Notiz",
  };
  assert.equal(validUploadRecovery(recovery), true);
  assert.equal(validUploadRecovery({ ...recovery, fragment: "invalid" }), false);
  assert.equal(validUploadRecovery({ ...recovery, files: [{ ...recovery.files[0], size: 0 }] }), false);
  assert.equal(validUploadRecovery({ ...recovery, days: "30" }), false);
  assert.equal(validUploadRecovery({ ...recovery, message: "x".repeat(501) }), false);
});

test("Cleanup-Trockenlauf verändert nichts", async (context) => {
  const now = Date.now();
  const { sharedRoot } = await createFixture(now);
  context.after(async () => (await import("node:fs/promises")).rm(sharedRoot, { recursive: true, force: true }));
  const result = await cleanupTransfersAtRoot({ sharedRoot, dryRun: true, now });
  assert.deepEqual(result, { expired: 1, incomplete: 1 });
  for (const folderName of Object.values(folders)) assert.equal(await exists(path.join(sharedRoot, folderName)), true);
});

test("Cleanup entfernt nur abgelaufene und alte unvollständige Uploads samt Reservierung", async (context) => {
  const now = Date.now();
  const { sharedRoot, reservationId } = await createFixture(now);
  context.after(async () => (await import("node:fs/promises")).rm(sharedRoot, { recursive: true, force: true }));
  const result = await cleanupTransfersAtRoot({ sharedRoot, now });
  assert.deepEqual(result, { expired: 1, incomplete: 1 });
  assert.equal(await exists(path.join(sharedRoot, folders.expired)), false);
  assert.equal(await exists(path.join(sharedRoot, folders.stale)), false);
  assert.equal(await exists(path.join(sharedRoot, ".reservations", `${reservationId}.json`)), false);
  assert.equal(await exists(path.join(sharedRoot, folders.active)), true);
  assert.equal(await exists(path.join(sharedRoot, folders.fresh)), true);
  assert.match(await readFile(path.join(sharedRoot, folders.active, "manifest.json"), "utf8"), /expiresAt/u);
});
