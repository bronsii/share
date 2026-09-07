import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { startHttpsTestServer } from "./https-test-server.mjs";

const sizeMiB = Number(process.env.TEST_LARGE_FILE_MIB ?? 0);
assert.ok(Number.isInteger(sizeMiB) && sizeMiB >= 0 && sizeMiB <= 5120, "TEST_LARGE_FILE_MIB must be 1–5120, or 0 to skip");
const browsers = { chromium, firefox, webkit };

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyZip(zipPath, size, hash) {
  const script = "import sys,zipfile,hashlib; z=zipfile.ZipFile(sys.argv[1]); assert z.namelist()==['large.bin','marker.txt']; assert z.read('marker.txt')==b'x'; assert z.getinfo('large.bin').file_size==int(sys.argv[2]); h=hashlib.sha256(); f=z.open('large.bin'); n=0\nwhile b:=f.read(1024*1024): h.update(b); n+=len(b)\nassert n==int(sys.argv[2]); assert h.hexdigest()==sys.argv[3]; f.close(); z.close()";
  const child = spawn(process.env.TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3"), ["-c", script, zipPath, String(size), hash], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`ZIP verification failed: ${stderr}`)));
  });
}

for (const name of (process.env.TEST_BROWSERS ?? "chromium,firefox,webkit").split(",")) {
  test(`${name}: ${sizeMiB} MiB real upload and streaming file/ZIP download`, { skip: sizeMiB === 0, timeout: 15 * 60_000 }, async (context) => {
    const { root, baseUrl } = await startHttpsTestServer(context);
    const source = path.join(root, "large.bin");
    // Leave one byte for a second file so the real multi-file ZIP action is available.
    const size = sizeMiB * 1024 ** 2 - 1;
    // Bounded memory: create a real disk file and let the browser read it from disk.
    const block = Buffer.alloc(1024 ** 2);
    for (let index = 0; index < block.length; index++) block[index] = index % 251;
    const file = await open(source, "wx");
    try {
      for (let count = 0; count < sizeMiB; count++) {
        block.writeUInt32LE(count, 0);
        let written = 0;
        const length = Math.min(block.length, size - count * block.length);
        while (written < length) written += (await file.write(block, written, length - written)).bytesWritten;
      }
    } finally { await file.close(); }
    const expectedHash = await sha256(source);
    const browser = await browsers[name].launch({
      downloadsPath: path.join(root, "downloads"),
      ...(name === "webkit" && process.env.TEST_WEBKIT_EXECUTABLE ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE } : {}),
      ...(name === "chromium" ? { args: ["--ignore-certificate-errors"] } : {}),
      ...(name === "firefox" ? { firefoxUserPrefs: { "browser.download.alwaysOpenPanel": false } } : {}),
    });
    context.after(() => browser.close());
    const browserContext = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, locale: "de-DE", reducedMotion: "reduce" });
    const page = await browserContext.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
    });
    await page.locator('input[type="file"]').setInputFiles(source);
    await page.locator('input[type="file"]').setInputFiles({ name: "marker.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await page.getByRole("checkbox").check();
    const started = Date.now();
    await page.getByRole("button", { name: "Hochladen & Link erstellen", exact: true }).click();
    await expect(page.locator(".share-link")).toBeVisible({ timeout: 12 * 60_000 });
    const uploadMs = Date.now() - started;
    const url = await page.locator(".share-link").getAttribute("href");
    await page.goto(url);
    await expect(page.getByText("large.bin", { exact: true })).toBeVisible();
    async function download(button) {
      if (name === "firefox") await page.keyboard.press("Escape");
      const pending = page.waitForEvent("download", { timeout: 60_000 });
      await button.click();
      const result = await pending;
      assert.equal(await result.failure(), null);
      return result.path();
    }
    const downloaded = await download(page.getByRole("button", { name: "large.bin sicher herunterladen", exact: true }));
    assert.equal((await stat(downloaded)).size, size);
    assert.equal(await sha256(downloaded), expectedHash);
    await expect(page.locator(".download-status-done")).toBeVisible();
    const zip = await download(page.getByRole("button", { name: "Alle Dateien herunterladen" }));
    await verifyZip(zip, size, expectedHash);
    assert.deepEqual(errors, []);
    context.diagnostic(`${name}: ${sizeMiB} MiB uploaded in ${(uploadMs / 1000).toFixed(1)} s; single download SHA-256 and independent streaming ZIP/CRC verification passed. Loopback throughput is not internet/mobile throughput.`);
  });
}
