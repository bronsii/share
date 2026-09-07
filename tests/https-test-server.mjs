import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

/** Isolated, loopback-only production server. Never accepts a production data path. */
export async function startHttpsTestServer(context) {
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(path.join(workRoot, "large-browser-test-"));
  const proxySecret = randomBytes(32).toString("hex");
  const server = await startNextTestServer(context, {
    env: { SHARED_ROOT: path.join(root, "shared"), SHARE_PROXY_SECRET: proxySecret },
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
  const key = path.join(root, "key.pem");
  const cert = path.join(root, "cert.pem");
  const result = spawnSync(process.env.TEST_OPENSSL ?? "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"]);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
  const proxy = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const upstream = httpRequest(new URL(req.url, server.baseUrl), {
      method: req.method,
      headers: { ...req.headers, "x-share-proxy-secret": proxySecret, "x-share-client-ip": "203.0.113.91", "x-forwarded-host": req.headers.host, "x-forwarded-proto": "https" },
    }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  context.after(() => { proxy.closeAllConnections(); proxy.close(); });
  return { root, baseUrl: `https://127.0.0.1:${proxy.address().port}` };
}
