import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

test("Only the independent sender token permits explicit same-origin deletion; existing shares stay compatible", async (context) => {
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(path.join(workRoot, "owner-test-"));
  const proxySecret = randomBytes(32).toString("hex");
  const { request } = await startNextTestServer(context, { env: { SHARED_ROOT: root, SHARE_PROXY_SECRET: proxySecret }, cleanup: () => rm(root, { recursive: true, force: true }) });
  const send = (url, options = {}) => request(url, { ...options, headers: { "X-Share-Proxy-Secret": proxySecret, "X-Share-Client-IP": "203.0.113.40", "X-Forwarded-Host": "sendebude.de", "X-Forwarded-Proto": "https", Origin: "https://sendebude.de", ...options.headers } });
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  async function create(managementTokenHash) {
    const response = await send("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ plaintextSize: 1, size: 17 }], days: 1, encryption: { version: 1, metadata: "A".repeat(40) }, terms: { accepted: true, version: "2026-08-16", language: "de" }, ...(managementTokenHash !== undefined ? { managementTokenHash } : {}) }) });
    return response;
  }
  assert.equal((await create("not-a-hash")).status, 400);
  const created = await create(hash);
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(JSON.stringify(session).includes(hash), false);
  assert.equal((await send(`/api/uploads/${session.id}/${session.files[0].id}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": "0" }, body: Buffer.alloc(17) })).status, 200);
  assert.equal((await send(`/api/uploads/${session.id}/complete`, { method: "POST" })).status, 201);
  const manifestPath = path.join(root, session.id.split("--")[0], "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  assert.equal(JSON.parse(manifestText).managementTokenHash, hash);
  assert.equal(manifestText.includes(token), false);
  const html = await (await send(`/t/${session.id}`)).text();
  assert.equal(html.includes(hash), false);
  assert.equal(html.includes(token), false);
  assert.equal(html.includes("managementToken"), false);
  const route = `/api/transfers/${session.id}/manage`;
  assert.equal((await send(route)).status, 405);
  for (const authorization of [undefined, "Bearer " + randomBytes(32).toString("base64url"), "Bearer v1." + token, "Bearer " + hash]) {
    assert.equal((await send(route, { method: "DELETE", headers: authorization ? { Authorization: authorization } : {} })).status, 404);
  }
  for (const origin of ["https://evil.example", "null", ""]) assert.equal((await send(route, { method: "DELETE", headers: { Origin: origin, Authorization: `Bearer ${token}` } })).status, 403);
  await access(manifestPath);
  assert.equal((await send(route, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status, 204);
  await assert.rejects(access(manifestPath));
  assert.equal((await send(`/api/transfers/${session.id}/${session.files[0].id}`)).status, 404);
  assert.equal((await send(route, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status, 404);
  const old = await create(undefined);
  assert.equal(old.status, 201, "Old clients without a management hash must continue to work");
  const oldSession = await old.json();
  const status = await send(`/api/uploads/${oldSession.id}`);
  assert.equal(status.status, 200);
  assert.equal((await send(`/api/transfers/${oldSession.id}/manage`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status, 404);
});
