import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import jsQR from "jsqr";
import { startNextTestServer, workRoot } from "./next-test-server.mjs";

const browsers = { chromium, firefox, webkit };
for (const name of (process.env.TEST_BROWSERS ?? "chromium,firefox,webkit").split(",")) {
  test(`${name}: real encrypted upload, QR, download, ZIP, retry, cancellation and sender deletion`, { timeout: 120_000 }, async (context) => {
    await mkdir(workRoot, { recursive: true });
    const root = await mkdtemp(path.join(workRoot, "browser-test-"));
    const proxySecret = randomBytes(32).toString("hex");
    const server = await startNextTestServer(context, { env: { SHARED_ROOT: root, SHARE_PROXY_SECRET: proxySecret }, cleanup: () => rm(root, { recursive: true, force: true }) });
    const requests = [];
    let slow = false;
    const keyPath = path.join(root, "test-key.pem");
    const certPath = path.join(root, "test-cert.pem");
    const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", certPath, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"]);
    assert.equal(certificate.status, 0, certificate.stderr.toString());
    const proxy = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
      requests.push(req.url);
      const upstream = httpRequest(new URL(req.url, server.baseUrl), {
        method: req.method,
        headers: { ...req.headers, "x-share-proxy-secret": proxySecret, "x-share-client-ip": "203.0.113.90", "x-forwarded-host": req.headers.host, "x-forwarded-proto": "https" },
      }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        if (slow && /^\/api\/transfers\/[^/]+\/[a-f0-9]{32}$/u.test(req.url)) {
          const timeout = setTimeout(() => response.pipe(res), 3_000);
          res.on("close", () => clearTimeout(timeout));
        } else response.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    context.after(() => { proxy.closeAllConnections(); proxy.close(); });
    const baseUrl = `https://127.0.0.1:${proxy.address().port}`;
    const browser = await browsers[name].launch({ ...(name === "webkit" && process.env.TEST_WEBKIT_EXECUTABLE ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE } : {}), ...(name === "chromium" ? { args: ["--ignore-certificate-errors"] } : {}) });
    context.after(() => browser.close());
    const browserContext = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true, acceptDownloads: true, locale: "de-DE", viewport: { width: 1440, height: 1000 } });
    const page = await browserContext.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    async function navigate(url) {
      // Avoid cancelling Next's background prefetches during synthetic navigations.
      await page.waitForLoadState("networkidle");
      await page.goto(url);
      await page.waitForLoadState("networkidle");
    }
    await navigate(baseUrl);
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
    });
    const binary = Buffer.alloc(5 * 1024 ** 2 + 17);
    for (let index = 0; index < binary.length; index++) binary[index] = index % 251;
    const note = Buffer.from("Grüße vom Browser-Test – diese Datei bleibt privat.\n");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "Prüfung.bin", mimeType: "application/octet-stream", buffer: binary },
      { name: "Notiz.txt", mimeType: "text/plain", buffer: note },
    ]);
    await page.getByRole("checkbox").check();
    await expect(page.getByText("Prüfung.bin", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hochladen & Link erstellen", exact: true }).click();
    await expect(page.locator(".share-link")).toBeVisible({ timeout: 20_000 });
    const shareUrl = await page.locator(".share-link").getAttribute("href");
    assert.match(shareUrl, /#v1\.[A-Za-z0-9_-]{43}$/u);
    await page.getByText("Freigabelink als QR-Code", { exact: true }).click();
    await expect(page.locator(".qr-panel canvas")).toHaveAttribute("width", "512");
    const qr = await page.locator(".qr-panel canvas").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      return { data: Array.from(pixels.data), width: canvas.width, height: canvas.height };
    });
    assert.equal(jsQR(Uint8ClampedArray.from(qr.data), qr.width, qr.height)?.data, shareUrl);
    await page.getByText("Nur für dich: Freigabe vorzeitig löschen", { exact: true }).click();
    const managementUrl = await page.locator("#sender-management-url").inputValue();
    const managementToken = new URL(managementUrl).hash.slice(4);
    assert.equal(shareUrl.includes(managementToken), false);
    const id = new URL(shareUrl).pathname.split("/").at(-1);
    const folder = path.join(root, id.split("--")[0]);
    const manifestText = await readFile(path.join(folder, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    assert.equal(manifestText.includes("Prüfung.bin"), false);
    assert.equal(manifestText.includes(managementToken), false);
    assert.equal(manifestText.includes(new URL(shareUrl).hash.slice(1)), false);
    assert.match(manifest.managementTokenHash, /^[a-f0-9]{64}$/u);
    await mkdir(workRoot, { recursive: true });
    await page.screenshot({ path: path.join(workRoot, `${name}-share.png`), fullPage: true });

    await navigate(shareUrl);
    await expect(page.getByText("Prüfung.bin", { exact: true })).toBeVisible();
    const downloadButton = page.getByRole("button", { name: "Prüfung.bin sicher herunterladen", exact: true });
    async function downloadAndRead(action) {
      const pending = page.waitForEvent("download");
      await action();
      const download = await pending.catch(async (failure) => { throw new Error(`${failure.message}; UI: ${await page.locator(".download-status").textContent({ timeout: 500 }).catch(() => "status missing")}`); });
      assert.equal(await download.failure(), null);
      return { download, bytes: await readFile(await download.path()) };
    }
    const single = await downloadAndRead(() => downloadButton.click());
    assert.equal(single.download.suggestedFilename(), "Prüfung.bin");
    assert.deepEqual(single.bytes, binary);
    await expect(page.locator(".download-status-done")).toBeVisible();
    const archive = await downloadAndRead(() => page.getByRole("button", { name: "Alle Dateien herunterladen" }).click());
    assert.equal(archive.download.suggestedFilename(), "Sendebude.zip");
    const unzip = spawnSync("python3", ["-c", "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==['Prüfung.bin','Notiz.txt']; data=z.read('Prüfung.bin'); assert len(data)==5*1024**2+17; assert all(b==i%251 for i,b in enumerate(data)); assert z.read('Notiz.txt').decode().startswith('Grüße vom Browser-Test'); assert z.testzip() is None"], { input: archive.bytes });
    assert.equal(unzip.status, 0, unzip.stderr.toString());
    await expect(page.locator(".download-status-done")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(workRoot, `${name}-download-mobile.png`), fullPage: true });

    const cipherPath = path.join(folder, manifest.files[0].storedName);
    const ciphertext = await readFile(cipherPath);
    const corrupt = Buffer.from(ciphertext); corrupt[20] ^= 1;
    await writeFile(cipherPath, corrupt);
    await downloadButton.click();
    await expect(page.locator(".download-status-failed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Erneut versuchen", exact: true })).toBeVisible();
    await writeFile(cipherPath, ciphertext);
    const retry = await downloadAndRead(() => page.getByRole("button", { name: "Erneut versuchen", exact: true }).click());
    assert.deepEqual(retry.bytes, binary);
    slow = true;
    await downloadButton.click();
    await expect(page.locator(".download-status-downloading")).toBeVisible();
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(page.locator(".download-status-cancelled")).toBeVisible();
    slow = false;
    assert.equal(requests.some((url) => url.includes(managementToken) || url.includes(new URL(shareUrl).hash.slice(1))), false);

    await navigate(new URL(shareUrl).pathname);
    await expect(page.getByRole("heading", { name: "Schlüssel fehlt oder ist ungültig." })).toBeVisible();
    await navigate(managementUrl);
    const deleteButton = page.getByRole("button", { name: "Freigabe jetzt löschen", exact: true });
    await expect(deleteButton).toBeDisabled();
    assert.equal(requests.some((url) => url.endsWith("/manage")), false, "Opening the sender link must never delete anything");
    await page.getByText("Ja, diese Freigabe unwiderruflich löschen.", { exact: true }).click();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await deleteButton.click();
    await expect(page.getByRole("heading", { name: "Freigabe gelöscht." })).toBeVisible();
    assert.equal(new URL(page.url()).hash, "");
    await navigate(shareUrl);
    await expect(page.getByRole("heading", { name: "Link nicht gefunden." })).toBeVisible();
    assert.deepEqual(errors, []);
  });
}
