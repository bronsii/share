import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

test("download locations and minute-rounded latest timestamps are authenticated and retained with the transfer", async (context) => {
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(path.join(workRoot, "access-location-test-"));
  const proxySecret = randomBytes(32).toString("hex");
  const sessionSecret = randomBytes(32).toString("hex");
  const { request } = await startNextTestServer(context, {
    env: { SHARED_ROOT: root, SHARE_PROXY_SECRET: proxySecret, SHARE_ADMIN_SESSION_SECRET: sessionSecret },
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
  const folderName = "2026-09-11_10-00-00-000";
  const id = `${folderName}--${"a".repeat(32)}`;
  const fileId = "b".repeat(32);
  await mkdir(path.join(root, folderName), { recursive: true });
  await writeFile(path.join(root, folderName, "test.txt"), "hello");
  await writeFile(path.join(root, folderName, "manifest.json"), JSON.stringify({
    id,
    folderName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    message: "",
    files: [{ id: fileId, name: "test.txt", storedName: "test.txt", size: 5, type: "text/plain" }],
  }));

  const send = (url, options = {}, ip = "72.229.28.185") => request(url, {
    ...options,
    headers: {
      "X-Share-Proxy-Secret": proxySecret,
      "X-Share-Client-IP": ip,
      ...options.headers,
    },
  });
  const earliestDownloadMinute = Date.now() - (Date.now() % 60_000);
  const first = await send(`/api/transfers/${id}/${fileId}`);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "hello");
  const second = await send(`/api/transfers/${id}/${fileId}`, {}, "24.48.0.1");
  assert.equal(second.status, 200);
  assert.equal(await second.text(), "hello");

  const denied = await request("/api/admin/transfers");
  assert.equal(denied.status, 401);

  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  const payload = `${expiresAt}.test-nonce`;
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  const response = await request("/api/admin/transfers", {
    headers: { Cookie: `__Host-share_admin_session=${payload}.${signature}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/u);
  const { transfers } = await response.json();
  assert.equal(transfers.length, 1);
  const transfer = transfers[0];
  assert.equal(transfer.downloadCount, 2);
  assert.equal(transfer.downloadLocations["US-NY"], 1);
  assert.equal(transfer.downloadLocations["CA-QC"], 1);
  for (const key of ["US-NY", "CA-QC"]) {
    const timestamp = transfer.downloadLocationLastAt[key];
    const parsedTimestamp = Date.parse(timestamp);
    assert.equal(typeof timestamp, "string");
    assert.equal(Number.isFinite(parsedTimestamp), true);
    assert.equal(parsedTimestamp >= earliestDownloadMinute, true);
    assert.equal(parsedTimestamp <= Date.now(), true);
    assert.equal(new Date(parsedTimestamp).getUTCSeconds(), 0);
    assert.equal(new Date(parsedTimestamp).getUTCMilliseconds(), 0);
  }
  assert.equal(JSON.stringify(transfer).includes("72.229.28.185"), false);
  assert.equal(JSON.stringify(transfer).includes("24.48.0.1"), false);

  const stored = await readFile(path.join(root, folderName, "manifest.json"), "utf8");
  assert.equal(stored.includes("72.229.28.185"), false);
  assert.equal(stored.includes("downloadLocations"), true);
  assert.equal(stored.includes("downloadLocationLastAt"), true);
  assert.equal(stored.includes("US-NY"), true);
  assert.equal(stored.includes("CA-QC"), true);
});

test("download location storage reports its bounded manifest limit without losing the total count", async (context) => {
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(path.join(workRoot, "access-location-limit-test-"));
  const proxySecret = randomBytes(32).toString("hex");
  const sessionSecret = randomBytes(32).toString("hex");
  const { request } = await startNextTestServer(context, {
    env: { SHARED_ROOT: root, SHARE_PROXY_SECRET: proxySecret, SHARE_ADMIN_SESSION_SECRET: sessionSecret },
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
  const folderName = "2026-09-11_10-00-00-001";
  const id = `${folderName}--${"c".repeat(32)}`;
  const fileId = "d".repeat(32);
  const downloadLocations = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [
    `AA-${index.toString(36).toUpperCase()}`,
    1,
  ]));
  await mkdir(path.join(root, folderName), { recursive: true });
  await writeFile(path.join(root, folderName, "test.txt"), "hello");
  await writeFile(path.join(root, folderName, "manifest.json"), JSON.stringify({
    id,
    folderName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    message: "",
    files: [{ id: fileId, name: "test.txt", storedName: "test.txt", size: 5, type: "text/plain" }],
    downloads: 128,
    downloadLocations,
  }));

  const download = await request(`/api/transfers/${id}/${fileId}`, {
    headers: {
      "X-Share-Proxy-Secret": proxySecret,
      "X-Share-Client-IP": "72.229.28.185",
    },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "hello");

  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  const payload = `${expiresAt}.limit-test-nonce`;
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  const response = await request("/api/admin/transfers", {
    headers: { Cookie: `__Host-share_admin_session=${payload}.${signature}` },
  });
  assert.equal(response.status, 200);
  const { transfers } = await response.json();
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].downloadCount, 129);
  assert.equal(Object.keys(transfers[0].downloadLocations).length, 128);
  assert.equal(transfers[0].downloadLocations["US-NY"], undefined);
  assert.equal(transfers[0].downloadLocationLastAt["US-NY"], undefined);
  assert.equal(transfers[0].downloadLocationsLimited, true);
});
