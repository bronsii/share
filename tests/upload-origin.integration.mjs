import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
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
  assert.equal(acceptedCreation.status, 201, await acceptedCreation.text());
  assert.equal(await pathExists(sharedRoot), true);
});
