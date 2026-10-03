import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startNextTestServer } from "./next-test-server.mjs";

test("Einzel- und ZIP-Downloads werden pro Datei gezählt", async (context) => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "share-download-counts-"));
  const folderName = "2026-10-03_14-27-00-000";
  const transferId = `${folderName}--${"a".repeat(32)}`;
  const proxySecret = "b".repeat(64);
  const sessionSecret = "c".repeat(64);
  const files = [
    { id: "d".repeat(32), name: "eins.txt", storedName: "eins.txt", size: 4, type: "text/plain" },
    { id: "e".repeat(32), name: "zwei.txt", storedName: "zwei.txt", size: 4, type: "text/plain" },
  ];
  const transferFolder = path.join(sharedRoot, folderName);
  await mkdir(transferFolder, { recursive: true });
  await writeFile(path.join(transferFolder, "eins.txt"), "eins");
  await writeFile(path.join(transferFolder, "zwei.txt"), "zwei");
  await writeFile(path.join(transferFolder, "manifest.json"), JSON.stringify({
    id: transferId,
    folderName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    message: "",
    files,
    views: 0,
    downloads: 0,
  }));

  const { request } = await startNextTestServer(context, {
    env: { SHARED_ROOT: sharedRoot, SHARE_PROXY_SECRET: proxySecret, SHARE_ADMIN_SESSION_SECRET: sessionSecret },
    cleanup: () => rm(sharedRoot, { recursive: true, force: true }),
  });
  const proxyHeaders = { "x-share-proxy-secret": proxySecret, "x-share-client-ip": "203.0.113.10" };
  assert.equal((await request(`/api/transfers/${transferId}/${files[0].id}`, { headers: proxyHeaders })).status, 200);
  assert.equal((await request(`/api/transfers/${transferId}/download-all`, { headers: proxyHeaders })).status, 200);

  const payload = `${Math.floor(Date.now() / 1000) + 3600}.download-counts`;
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  const response = await request("/api/admin/transfers", {
    headers: { Cookie: `__Host-share_admin_session=${payload}.${signature}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.transfers[0].downloadCount, 2);
  assert.deepEqual(body.transfers[0].files.map((file) => file.downloadCount), [2, 1]);
});
