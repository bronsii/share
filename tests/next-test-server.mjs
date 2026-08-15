import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const workRoot = path.join(projectRoot, "work");

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
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

export async function startNextTestServer(context, { env = {}, cleanup } = {}) {
  const port = await unusedPort();
  const server = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        SHARE_PROXY_SECRET: randomBytes(32).toString("hex"),
        SHARE_ADMIN_CODE: "integration-test-admin-code",
        SHARE_ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
        SHARE_IMPRINT_NAME: "Test Name",
        SHARE_IMPRINT_STREET: "Teststraße 1",
        SHARE_IMPRINT_LOCALITY: "12345 Teststadt",
        SHARE_IMPRINT_COUNTRY: "Deutschland",
        SHARE_IMPRINT_EMAIL: "test@example.com",
        ...env,
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
    try {
      await stopServer(server);
    } finally {
      await cleanup?.();
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilReady(server, baseUrl, () => serverOutput);
  return {
    baseUrl,
    output: () => serverOutput,
    request: (url, options) => fetch(`${baseUrl}${url}`, options),
  };
}
