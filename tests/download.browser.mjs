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
    let heldDownload = null;
    let rejectChunk = true;
    let loseChunkResponse = true;
    let failAdminRefresh = false;
    const committedChunks = new Map();
    const keyPath = path.join(root, "test-key.pem");
    const certPath = path.join(root, "test-cert.pem");
    const certificate = spawnSync(process.env.TEST_OPENSSL ?? "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", certPath, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"]);
    assert.ifError(certificate.error);
    assert.equal(certificate.status, 0, certificate.stderr.toString());
    const proxy = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
      requests.push(req.url);
      if (req.url === "/api/admin/transfers" && failAdminRefresh) {
        failAdminRefresh = false;
        req.resume();
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end('{"error":"Test outage"}');
        return;
      }
      if (req.method === "PUT" && rejectChunk) {
        rejectChunk = false;
        req.resume();
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "2" });
        res.end(JSON.stringify({ error: "Temporary test interruption" }));
        return;
      }
      const downloadGate = req.method === "GET" && req.url === heldDownload?.url ? heldDownload : null;
      if (downloadGate) {
        downloadGate.requested = true;
        res.once("close", () => { downloadGate.aborted = !res.writableEnded; });
      }
      const upstream = httpRequest(new URL(req.url, server.baseUrl), {
        method: req.method,
        headers: { ...req.headers, "x-share-proxy-secret": proxySecret, "x-share-client-ip": "203.0.113.90", "x-forwarded-host": req.headers.host, "x-forwarded-proto": "https" },
      }, (response) => {
        if (req.method === "PUT" && response.statusCode === 200) {
          const chunk = `${req.url}@${req.headers["x-upload-offset"]}`;
          committedChunks.set(chunk, (committedChunks.get(chunk) ?? 0) + 1);
          if (loseChunkResponse) {
            loseChunkResponse = false;
            // Server committed the encrypted block, but its acknowledgement is lost.
            response.resume();
            res.destroy();
            return;
          }
        }
        res.writeHead(response.statusCode, response.headers);
        if (downloadGate) {
          // Keep a real encrypted fetch pending until the user cancels it.
          // A fixed delay can expire before a busy CI browser reaches Abbrechen.
          downloadGate.destroy = () => response.destroy();
        } else if (req.method === "PUT" && Number(req.headers["x-upload-offset"]) > 0) {
          // After the lost acknowledgement, loopback can finish the remaining bytes
          // inside the speed meter's one-second sampling window. Pace this successful
          // acknowledgement so actual byte progress spans a fresh measurement window.
          const timeout = setTimeout(() => response.pipe(res), 1_250);
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
    const browser = await browsers[name].launch({
      ...(name === "webkit" && process.env.TEST_WEBKIT_EXECUTABLE ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE } : {}),
      ...(name === "chromium" ? { args: ["--ignore-certificate-errors"] } : {}),
      ...(name === "firefox" ? { firefoxUserPrefs: { "browser.download.alwaysOpenPanel": false, "browser.download.panel.shown": true } } : {}),
    });
    context.after(() => browser.close());
    // Smooth scrolling can race Firefox's synthetic clicks on off-screen controls.
    // Use the site's own reduced-motion support for deterministic interactions.
    const browserContext = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true, acceptDownloads: true, reducedMotion: "reduce", locale: "de-DE", viewport: { width: 1440, height: 1000 } });
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
    let releaseCompletion;
    const completionGate = new Promise((resolve) => { releaseCompletion = resolve; });
    context.after(() => releaseCompletion());
    await page.route("**/api/uploads/*/complete", async (route) => {
      await completionGate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Hochladen & Link erstellen", exact: true }).click();
    await expect(page.locator(".upload-retry-status")).toBeVisible();
    assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true, "An unfinished upload must install the close warning");
    await expect(page.locator(".upload-summary .upload-speed")).toHaveText(/\d.*\/s/u, { timeout: 20_000 });
    await expect(page.locator(".upload-speed")).toHaveCount(1);
    await expect(page.locator(".file-speed")).toHaveCount(0);
    await expect(page.locator(".file-progress")).toHaveCount(2);
    await expect(page.locator(".file-actions button")).toHaveCount(2);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator(".file-row").first().evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(" ").length), width === 390 ? 4 : 5);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    await expect(page.locator(".upload-pause-toggle")).toBeVisible();
    await expect(page.locator(".upload-cancel-all")).toBeVisible();
    releaseCompletion();
    await expect(page.locator(".share-link")).toBeVisible({ timeout: 20_000 });
    assert.equal(rejectChunk, false);
    assert.equal(loseChunkResponse, false);
    assert.deepEqual([...committedChunks.values()], [1, 1, 1], "Three chunks must be committed exactly once despite failures");
    await expect.poll(() => page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), { message: "Completion must remove the close warning after React effects settle" }).toBe(false);
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
    assert.equal(await page.evaluate(() => localStorage.getItem("sendebude-recent-transfers-v1")), null, "No local history without explicit consent");
    await page.getByRole("button", { name: "Diese Freigabe auf diesem Gerät merken", exact: true }).click();
    const remembered = page.getByRole("region", { name: "Auf diesem Gerät gemerkt" });
    await expect(remembered.getByRole("link", { name: "Öffnen", exact: true })).toHaveAttribute("href", shareUrl);
    // A second tab receives storage events, but listing must not fetch either private link.
    const secondTab = await browserContext.newPage();
    await secondTab.goto(baseUrl);
    const secondList = secondTab.getByRole("region", { name: "Auf diesem Gerät gemerkt" });
    await expect(secondList.getByRole("link", { name: "Öffnen", exact: true })).toHaveAttribute("href", shareUrl);
    await secondList.getByRole("button", { name: "Nur lokal entfernen", exact: true }).click();
    await expect(remembered.getByRole("link", { name: "Öffnen", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Diese Freigabe auf diesem Gerät merken", exact: true }).click();
    await expect(secondList.getByRole("link", { name: "Öffnen", exact: true })).toBeVisible();
    await secondTab.close();
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
    async function prepareDownloadInteraction() {
      // Firefox's native download popover can consume the next synthetic pointer click.
      // Dismiss browser chrome; do not change any page state or download protection.
      if (name === "firefox") {
        await page.bringToFront();
        await page.keyboard.press("Escape");
      }
    }
    async function downloadAndRead(action) {
      await prepareDownloadInteraction();
      const pending = page.waitForEvent("download");
      await action();
      const download = await pending.catch(async (failure) => { throw new Error(`${failure.message}; UI: ${await page.locator(".download-status").textContent({ timeout: 500 }).catch(() => "status missing")}`); });
      assert.equal(await download.failure(), null);
      return { download, bytes: await readFile(await download.path()) };
    }
    const single = await downloadAndRead(() => downloadButton.click());
    // Windows' Playwright WebKit port uses Content-Disposition's ASCII fallback.
    // Verify that known fallback explicitly; ZIP entry names still must retain UTF-8.
    const expectedFilename = name === "webkit" && process.platform === "win32" ? "Pr_fung.bin" : "Prüfung.bin";
    assert.equal(single.download.suggestedFilename(), expectedFilename);
    assert.deepEqual(single.bytes, binary);
    await expect(page.locator(".download-status-done")).toBeVisible();
    const archive = await downloadAndRead(() => page.getByRole("button", { name: "Alle Dateien herunterladen" }).click());
    assert.equal(archive.download.suggestedFilename(), "Sendebude.zip");
    const unzip = spawnSync(process.env.TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3"), ["-c", "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==['Prüfung.bin','Notiz.txt']; data=z.read('Prüfung.bin'); assert len(data)==5*1024**2+17; assert all(b==i%251 for i,b in enumerate(data)); assert z.read('Notiz.txt').decode().startswith('Grüße vom Browser-Test'); assert z.testzip() is None"], { input: archive.bytes });
    assert.ifError(unzip.error);
    assert.equal(unzip.status, 0, unzip.stderr.toString());
    await expect(page.locator(".download-status-done")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(workRoot, `${name}-download-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    const cipherPath = path.join(folder, manifest.files[0].storedName);
    const ciphertext = await readFile(cipherPath);
    const corrupt = Buffer.from(ciphertext); corrupt[20] ^= 1;
    await writeFile(cipherPath, corrupt);
    await prepareDownloadInteraction();
    await downloadButton.click();
    await expect(page.locator(".download-status-failed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Erneut versuchen", exact: true })).toBeVisible();
    await writeFile(cipherPath, ciphertext);
    // Also verify that recovery can be operated from the keyboard.
    const retry = await downloadAndRead(() => page.getByRole("button", { name: "Erneut versuchen", exact: true }).press("Enter"));
    assert.deepEqual(retry.bytes, binary);
    await expect(page.locator(".download-status-done")).toBeVisible();
    const downloadGate = { url: `/api/transfers/${id}/${manifest.files[0].id}`, requested: false, aborted: false, destroy: () => {} };
    heldDownload = downloadGate;
    context.after(() => downloadGate.destroy());
    await prepareDownloadInteraction();
    // Firefox can still swallow a pointer click as its native save UI settles.
    // Give post-retry actions explicit keyboard focus; file/ZIP pointer actions
    // are covered above, and Chromium/WebKit also cover pointer cancellation.
    await expect(downloadButton).toBeEnabled();
    if (name === "firefox") await downloadButton.press("Enter");
    else await downloadButton.click();
    await expect.poll(async () => ({
      requested: downloadGate.requested,
      phase: await page.locator(".download-status").getAttribute("class"),
    }), { timeout: 20_000, message: "A real encrypted GET must be in flight before cancellation" }).toEqual({
      requested: true,
      phase: "download-status download-status-downloading",
    });
    await expect(page.locator(".download-status-downloading")).toBeVisible();
    const cancelButton = page.getByRole("button", { name: "Abbrechen", exact: true });
    await expect(cancelButton).toBeEnabled();
    if (name === "firefox") await cancelButton.press("Enter");
    else await cancelButton.click();
    await expect(page.locator(".download-status-cancelled")).toBeVisible();
    await expect.poll(() => downloadGate.aborted, { message: "Cancellation must close the pending encrypted response without completing it" }).toBe(true);
    downloadGate.destroy();
    heldDownload = null;
    assert.equal(requests.some((url) => url.includes(managementToken) || url.includes(new URL(shareUrl).hash.slice(1))), false);

    await navigate(new URL(shareUrl).pathname);
    await expect(page.getByRole("heading", { name: "Schlüssel fehlt oder ist ungültig." })).toBeVisible();
    await navigate(managementUrl);
    const deleteButton = page.getByRole("button", { name: "Freigabe jetzt löschen", exact: true });
    await expect(deleteButton).toBeDisabled();
    assert.equal(requests.some((url) => url.endsWith("/manage")), false, "Opening the sender link must never delete anything");
    await page.bringToFront();
    if (name === "firefox") await page.keyboard.press("Escape");
    await page.getByRole("checkbox").press("Space");
    await expect(page.getByRole("checkbox")).toBeChecked();
    await deleteButton.press("Enter");
    await expect(page.getByRole("heading", { name: "Freigabe gelöscht." })).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem("sendebude-recent-transfers-v1")), null, "Confirmed sender deletion also forgets the local entry");
    assert.equal(new URL(page.url()).hash, "");
    await navigate(shareUrl);
    await expect(page.getByRole("heading", { name: "Link nicht gefunden." })).toBeVisible();

    await navigate("/verwaltung");
    await page.getByLabel("Admin-Passphrase", { exact: true }).fill("integration-test-admin-code");
    await page.getByRole("button", { name: "Anmelden", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Betriebsstatus", exact: true })).toBeVisible();
    await expect(page.getByText("Noch kein erfolgreicher planmäßiger Bereinigungslauf bestätigt. Bitte den Cleanup-Timer prüfen.", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(workRoot, `${name}-operations.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(workRoot, `${name}-operations-mobile.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    // Inject at the HTTPS proxy, independent of browser interception/service workers.
    failAdminRefresh = true;
    const refresh = page.getByRole("button", { name: "Liste und Betriebsstatus aktualisieren", exact: true });
    const failedRefresh = page.waitForResponse((response) => response.url().endsWith("/api/admin/transfers"));
    await refresh.press("Enter");
    assert.equal((await failedRefresh).status(), 503);
    await expect(page.locator(".admin-error")).toBeVisible();
    await expect(refresh).toBeEnabled();
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/admin/transfers"));
    await refresh.press("Enter");
    assert.equal((await refreshed).status(), 200, "Refreshing after a network interruption must succeed");
    // Next's persistent route announcer also has role=alert; inspect the admin error only.
    await expect(page.locator(".admin-error")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Abmelden", exact: true }).press("Enter");
    await expect(page.getByLabel("Admin-Passphrase", { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  });
}
