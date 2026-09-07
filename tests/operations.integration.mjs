import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { recordScheduledCleanup } from "../lib/operations-state.mjs";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

test("Operations summary is authenticated, no-store, read-only and exposes scheduled cleanup health", async (context) => {
  await mkdir(workRoot, { recursive: true });
  const sharedRoot = await mkdtemp(path.join(workRoot, "operations-test-"));
  const secret = randomBytes(32).toString("hex");
  const reservationId = "a".repeat(32);
  await mkdir(path.join(sharedRoot, ".reservations"));
  const reservationFile = path.join(sharedRoot, ".reservations", `${reservationId}.json`);
  await writeFile(reservationFile, JSON.stringify({ id: reservationId, remainingBytes: 512, updatedAt: new Date().toISOString() }));
  const before = await readFile(reservationFile, "utf8");
  await recordScheduledCleanup({ sharedRoot, success: true, result: { expired: 1, incomplete: 2 } });
  const { request } = await startNextTestServer(context, {
    env: { SHARED_ROOT: sharedRoot, SHARE_ADMIN_SESSION_SECRET: secret },
    cleanup: () => rm(sharedRoot, { recursive: true, force: true }),
  });
  const denied = await request("/api/admin/transfers");
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("cache-control"), /no-store/u);
  assert.equal(JSON.stringify(await denied.json()).includes("operations"), false);
  const payload = `${Math.floor(Date.now() / 1000) + 3600}.test-nonce`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const headers = { Cookie: `__Host-share_admin_session=${payload}.${signature}` };
  const response = await request("/api/admin/transfers", { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/u);
  const { operations } = await response.json();
  assert.equal(operations.storage.reservedUploadBytes, 512);
  assert.equal(operations.storage.incompleteUploads, 0);
  assert.equal(operations.cleanup.status, "ok");
  assert.deepEqual(operations.cleanup.lastSuccessCounts, { expired: 1, incomplete: 2 });
  assert.equal(JSON.stringify(operations).includes(reservationId), false);
  assert.equal(JSON.stringify(operations).includes(sharedRoot), false);
  assert.equal(await readFile(reservationFile, "utf8"), before);
  await recordScheduledCleanup({ sharedRoot, success: false });
  const failed = await (await request("/api/admin/transfers", { headers })).json();
  assert.equal(failed.operations.cleanup.status, "failed");
  assert.equal(failed.operations.cleanup.lastSuccessAt, operations.cleanup.lastSuccessAt);
});
