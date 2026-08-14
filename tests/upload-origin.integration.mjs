import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(projectRoot, "work");

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForExit(server, timeoutMs) {
  if (server.exitCode !== null || server.signalCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    let timeout;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref();
    server.once("exit", onExit);
    if (server.exitCode !== null || server.signalCode !== null) finish(true);
  });
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  const stopped = await waitForExit(server, 5_000);
  if (stopped) return;
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await waitForExit(server, 5_000);
  }
}

async function waitUntilReady(server, baseUrl, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Testserver wurde vorzeitig beendet.\n${output()}`);
    }
    try {
      await fetch(`${baseUrl}/api/uploads/not-found`, { signal: AbortSignal.timeout(500) });
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Testserver wurde nicht rechtzeitig bereit.\n${output()}`);
}

test("Upload-Routen blockieren fremde Ursprünge vor jedem Seiteneffekt", { timeout: 30_000 }, async (context) => {
  await mkdir(workRoot, { recursive: true });
  const sharedRoot = await mkdtemp(path.join(workRoot, "origin-test-"));
  await rm(sharedRoot, { recursive: true, force: true });
  const port = await unusedPort();
  const proxySecret = randomBytes(32).toString("hex");
  const server = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SHARED_ROOT: sharedRoot,
        SHARE_PROXY_SECRET: proxySecret,
        SHARE_ADMIN_CODE: "integration-test-admin-code",
        SHARE_ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
        SHARE_IMPRINT_NAME: "Test Name",
        SHARE_IMPRINT_STREET: "Teststraße 1",
        SHARE_IMPRINT_LOCALITY: "12345 Teststadt",
        SHARE_IMPRINT_COUNTRY: "Deutschland",
        SHARE_IMPRINT_EMAIL: "test@example.com",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverOutput = "";
  const recordOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  };
  server.stdout.on("data", recordOutput);
  server.stderr.on("data", recordOutput);
  context.after(async () => {
    await stopServer(server);
    await rm(sharedRoot, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilReady(server, baseUrl, () => serverOutput);
  const proxyHeaders = {
    "X-Share-Proxy-Secret": proxySecret,
    "X-Share-Client-IP": "203.0.113.10",
    "X-Forwarded-Host": "sendebude.de",
    "X-Forwarded-Proto": "https",
  };
  const send = (url, options = {}) => fetch(`${baseUrl}${url}`, {
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
