import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("Upload-Routen blockieren fremde Ursprünge vor jedem Seiteneffekt", { timeout: 30_000 }, async (context) => {
  await mkdir(workRoot, { recursive: true });
  const sharedRoot = await mkdtemp(path.join(workRoot, "origin-test-"));
  await rm(sharedRoot, { recursive: true, force: true });
  const proxySecret = randomBytes(32).toString("hex");
  const { request } = await startNextTestServer(context, {
    env: { SHARED_ROOT: sharedRoot, SHARE_PROXY_SECRET: proxySecret },
    cleanup: () => rm(sharedRoot, { recursive: true, force: true }),
  });
  const proxyHeaders = {
    "X-Share-Proxy-Secret": proxySecret,
    "X-Share-Client-IP": "203.0.113.10",
    "X-Forwarded-Host": "sendebude.de",
    "X-Forwarded-Proto": "https",
  };
  const send = (url, options = {}) => request(url, {
    ...options,
    headers: { ...proxyHeaders, ...options.headers },
  });
  const validUploadBody = JSON.stringify({
    files: [{ plaintextSize: 1, size: 17 }],
    days: 1,
    encryption: { version: 1, metadata: "A".repeat(40) },
    terms: { accepted: true, version: "2026-08-16", language: "de" },
  });

  const blockedCreation = await send("/api/uploads", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
    body: validUploadBody,
  });
  assert.equal(blockedCreation.status, 403);
  assert.equal(blockedCreation.headers.get("cache-control"), "no-store");

  const blockedMutations = await Promise.all([
    send("/api/uploads/fake/fake", {
      method: "PUT",
      headers: { Origin: "https://evil.example", "Content-Type": "application/octet-stream", "X-Upload-Offset": "0" },
      body: "x",
    }),
    send("/api/uploads/fake/fake", {
      method: "DELETE",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    send("/api/uploads/fake", { method: "DELETE", headers: { Origin: "https://evil.example" } }),
    send("/api/uploads/fake/complete", { method: "POST", headers: { Origin: "https://evil.example" } }),
  ]);
  assert.deepEqual(blockedMutations.map((response) => response.status), [403, 403, 403, 403]);

  for (const origin of [undefined, "null", "http://sendebude.de", "https://sendebude.de.evil.example", "https://sendebude.de:444"]) {
    const response = await send("/api/uploads", {
      method: "POST",
      headers: {
        ...(origin ? { Origin: origin } : {}),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 403, `Origin ${String(origin)} muss blockiert werden`);
  }

  const wrongContentType = await send("/api/uploads", {
    method: "POST",
    headers: { Origin: "https://sendebude.de", "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);
  assert.equal(await pathExists(sharedRoot), false, "Blockierte Anfragen dürfen weder Rate-Limits noch Reservierungen anlegen");

  const acceptedCreation = await send("/api/uploads", {
    method: "POST",
    headers: { Origin: "https://sendebude.de", "Content-Type": "application/json; charset=UTF-8" },
    body: validUploadBody,
  });
  const acceptedCreationBody = await acceptedCreation.text();
  assert.equal(acceptedCreation.status, 201, acceptedCreationBody);
  const acceptedSession = JSON.parse(acceptedCreationBody);
  assert.equal(await pathExists(sharedRoot), true);
  const transferFolder = (await readdir(sharedRoot, { withFileTypes: true }))
    .find((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}_/u.test(entry.name));
  assert.ok(transferFolder, "Erstellte Upload-Sitzung muss gespeichert sein");
  const storedSession = JSON.parse(await readFile(path.join(sharedRoot, transferFolder.name, "upload.json"), "utf8"));
  assert.deepEqual(storedSession.termsAcceptance, {
    version: "2026-08-16",
    language: "de",
    acceptedAt: storedSession.createdAt,
  });

  const chunkUpload = await send(`/api/uploads/${acceptedSession.id}/${acceptedSession.files[0].id}`, {
    method: "PUT",
    headers: {
      Origin: "https://sendebude.de",
      "Content-Type": "application/octet-stream",
      "X-Upload-Offset": "0",
    },
    body: Buffer.alloc(17),
  });
  assert.equal(chunkUpload.status, 200, await chunkUpload.text());
  const completion = await send(`/api/uploads/${acceptedSession.id}/complete`, {
    method: "POST",
    headers: { Origin: "https://sendebude.de" },
  });
  assert.equal(completion.status, 201, await completion.text());
  const storedManifest = JSON.parse(await readFile(path.join(sharedRoot, transferFolder.name, "manifest.json"), "utf8"));
  assert.deepEqual(storedManifest.termsAcceptance, storedSession.termsAcceptance);
  assert.equal(await pathExists(path.join(sharedRoot, transferFolder.name, "upload.json")), false);

  const invalidTerms = [
    undefined,
    { accepted: true, version: "veraltet", language: "de" },
    { accepted: true, version: "2026-08-16", language: "fr" },
  ];
  for (const terms of invalidTerms) {
    const response = await send("/api/uploads", {
      method: "POST",
      headers: { Origin: "https://sendebude.de", "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ plaintextSize: 1, size: 17 }],
        days: 1,
        encryption: { version: 1, metadata: "A".repeat(40) },
        ...(terms ? { terms } : {}),
      }),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Nutzungsbedingungen/u);
  }
});
