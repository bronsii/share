import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startHttpsTestServer } from "./https-test-server.mjs";

const browsers = { chromium, webkit };
const recentStorageKey = "sendebude-recent-transfers-v1";
const recoveryStorageKey = "share-upload-recovery-v1";
const savedSection = 'section[aria-labelledby="recent-transfers-heading"]';
const fixture = (name) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`LOCAL TEST ONLY: ${name}\n`) });

async function openLocalPage(context, browser, baseUrl, options = {}) {
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1", "Use only the isolated loopback HTTPS server");
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    ...options,
  });
  const state = { requests: [], blocked: [], dialogs: [], errors: [], heldChunks: [], holdChunks: false, failDelete: false, acceptDialogs: false };
  await browserContext.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const localUpload = /^\/api\/uploads(?:\/[^/]+(?:\/(?:[a-f0-9]{32}|complete))?)?$/u.test(url.pathname);
    const localManagement = /^\/api\/transfers\/[^/]+\/manage$/u.test(url.pathname);
    const localView = method === "POST" && /^\/api\/transfers\/[^/]+\/view$/u.test(url.pathname);
    // Fail closed: only this temporary server may receive these synthetic files.
    if (url.origin !== baseUrl || (!["GET", "HEAD"].includes(method) && !localUpload && !localManagement && !localView)) {
      state.blocked.push(`${method} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    state.requests.push({ method, pathname: url.pathname });
    if (method === "PUT" && state.holdChunks) {
      // Gate a single tiny encrypted chunk, without large files or timed delays.
      state.heldChunks.push(route);
      return;
    }
    if (method === "DELETE" && localUpload && state.failDelete) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"LOCAL TEST deletion interruption"}' });
      return;
    }
    await route.continue();
  });
  const page = await browserContext.newPage();
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("dialog", async (dialog) => {
    state.dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (state.acceptDialogs) await dialog.accept();
    else await dialog.dismiss();
  });
  context.after(async () => {
    for (const route of state.heldChunks) await route.abort().catch(() => {});
    await browserContext.close();
    assert.deepEqual(state.blocked, [], "No external or unrelated mutating requests");
    assert.deepEqual(state.errors, [], "No client errors during the reset flow");
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
  return { page, state };
}

async function seedLocalRememberedShare(page, baseUrl) {
  const id = `2026-09-09_12-00-00-000--${"a".repeat(32)}`;
  const entry = {
    id,
    url: `${baseUrl}/t/${id}#v1.${"A".repeat(43)}`,
    managementUrl: `${baseUrl}/verwalten/${id}#m1.${"B".repeat(43)}`,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const raw = JSON.stringify({ version: 1, entries: [entry] });
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event("sendebude-recent-transfers-changed"));
  }, { key: recentStorageKey, value: raw });
  await expect(page.locator(`${savedSection} a`).first()).toHaveAttribute("href", entry.url);
  return raw;
}

async function prepareSelection(page, language, name) {
  await page.getByRole("button", { name: language, exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture(name));
  await page.locator(".settings-row textarea").fill(`LOCAL TEST note ${language}`);
  await page.locator(".settings-row select").selectOption("7");
  await page.locator("#terms-accepted").check();
  await expect(page.locator(".file-name")).toHaveText(name);
}

async function assertEmptyTransfer(page) {
  await expect(page.locator(".file-row")).toHaveCount(0);
  await expect(page.locator(".share-link, .upload-summary, .upload-recovery, .form-error")).toHaveCount(0);
  await expect(page.locator(".settings-row textarea")).toHaveValue("");
  await expect(page.locator(".settings-row select")).toHaveValue("3");
  await expect(page.locator("#terms-accepted")).not.toBeChecked();
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await expect(page.locator(".transfer-card .primary-button")).toBeDisabled();
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), recoveryStorageKey), null);
  assert.equal(new URL(page.url()).pathname, "/");
}

async function assertRememberedShare(page, raw) {
  const stored = await page.evaluate((key) => localStorage.getItem(key), recentStorageKey);
  assert.deepEqual(JSON.parse(stored), JSON.parse(raw), "Reset preserves every remembered field (storage normalizes JSON property order)");
  await expect(page.locator(`${savedSection} a`).first()).toHaveAttribute("href", JSON.parse(raw).entries[0].url);
}

async function clickLogoWithConfirmation(page, state, language, accept) {
  const before = state.dialogs.length;
  state.acceptDialogs = accept;
  await page.locator(".site-domain").click();
  await expect.poll(() => state.dialogs.length).toBe(before + 1);
  const dialog = state.dialogs.at(-1);
  assert.equal(dialog.type, "confirm");
  assert.match(dialog.message, language === "DE" ? /^Gesamten Upload abbrechen\?/u : /^Cancel the entire upload\?/u);
  assert.match(dialog.message, language === "DE" ? /pausiert/u : /paused/u);
  state.acceptDialogs = false;
}

async function uploadStatus(page, id) {
  return page.evaluate(async (sessionId) => (await fetch(`/api/uploads/${sessionId}`, { cache: "no-store" })).status, id);
}

for (const name of (process.env.TEST_BROWSERS ?? "chromium,webkit").split(",").map((value) => value.trim()).filter(Boolean)) {
  assert.ok(name in browsers, `home-reset supports TEST_BROWSERS=chromium,webkit; received ${name}`);
  test(`${name}: home logo safely starts a fresh transfer and mobile controls stay zoom-friendly`, { timeout: 180_000 }, async (context) => {
    const { baseUrl } = await startHttpsTestServer(context);
    const browser = await browsers[name].launch({
      headless: true,
      ...(name === "webkit" && process.env.TEST_WEBKIT_EXECUTABLE ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE } : {}),
    });
    context.after(() => browser.close());

    await context.test("DE and EN: logo clears a selection and leaves remembered shares alone", async (subtest) => {
      const { page, state } = await openLocalPage(subtest, browser, baseUrl);
      const remembered = await seedLocalRememberedShare(page, baseUrl);
      await expect(page.locator(".site-domain")).toHaveAttribute("href", "/");
      for (const language of ["DE", "EN"]) {
        await prepareSelection(page, language, `selected-${language}.txt`);
        await page.locator(".site-domain").click();
        await assertEmptyTransfer(page);
        await assertRememberedShare(page, remembered);
        await expect(page.locator("#transfer-title")).toHaveText(language === "DE" ? "Was möchtest du teilen?" : "What are you sharing?");
      }
      assert.deepEqual(state.dialogs, [], "Selection-only reset needs no destructive confirmation");
      assert.deepEqual(state.requests.filter(({ method }) => !["GET", "HEAD"].includes(method)), [], "Selection-only reset does not create or delete anything on the server");
    });

    await context.test("completed: logo keeps the saved live share and permits a second upload", async (subtest) => {
      const { baseUrl } = await startHttpsTestServer(subtest);
      const { page, state } = await openLocalPage(subtest, browser, baseUrl);
      await prepareSelection(page, "EN", "completed-first.txt");
      await page.locator(".transfer-card .primary-button").click();
      await expect(page.locator(".share-link")).toBeVisible({ timeout: 20_000 });
      const firstUrl = await page.locator(".share-link").getAttribute("href");
      assert.equal(new URL(firstUrl).origin, baseUrl);
      await page.getByRole("button", { name: "Remember this share on this device", exact: true }).click();
      await expect(page.locator(savedSection)).toBeVisible();
      const remembered = await page.evaluate((key) => localStorage.getItem(key), recentStorageKey);
      assert.ok(remembered);
      await page.locator(".site-domain").click();
      await assertEmptyTransfer(page);
      await assertRememberedShare(page, remembered);
      // A genuinely new upload still requires fresh terms consent.
      await page.locator('input[type="file"]').setInputFiles(fixture("completed-second.txt"));
      await expect(page.locator(".transfer-card .primary-button")).toBeDisabled();
      await page.locator("#terms-accepted").check();
      await page.locator(".transfer-card .primary-button").click();
      await expect(page.locator(".share-link")).toBeVisible({ timeout: 20_000 });
      const secondUrl = await page.locator(".share-link").getAttribute("href");
      assert.notEqual(firstUrl, secondUrl);
      await assertRememberedShare(page, remembered);
      assert.deepEqual(state.dialogs, [], "Completed transfers are not cancelled by starting over");
      assert.deepEqual(state.requests.filter(({ method }) => method === "DELETE"), [], "Neither completed upload was deleted");
      const reader = await page.context().newPage();
      await reader.goto(firstUrl, { waitUntil: "networkidle" });
      await expect(reader.getByRole("button", { name: "Download completed-first.txt securely", exact: true })).toBeVisible();
      await reader.close();
    });

    for (const mode of ["running", "paused", "recovery"]) {
      await context.test(`${mode}: dismiss preserves state; confirmed successful deletion resets it`, async (subtest) => {
        // Independent storage and real limits: earlier unfinished test uploads
        // must not exhaust the next scenario's anonymous session allowance.
        const { baseUrl } = await startHttpsTestServer(subtest);
        const { page, state } = await openLocalPage(subtest, browser, baseUrl);
        const language = mode === "paused" ? "EN" : "DE";
        const fileName = `${mode}-local.txt`;
        const remembered = await seedLocalRememberedShare(page, baseUrl);
        await prepareSelection(page, language, fileName);
        state.holdChunks = true;
        await page.locator(".transfer-card .primary-button").click();
        await expect.poll(() => state.heldChunks.length).toBe(1);
        await expect(page.locator(".upload-pause-toggle")).toBeEnabled();
        if (mode !== "running") {
          await page.locator(".upload-pause-toggle").click();
          await expect(page.locator(".upload-pause-toggle")).toHaveAttribute("aria-label", language === "DE" ? "Upload fortsetzen" : "Resume upload");
        }
        if (mode === "recovery") {
          state.acceptDialogs = true;
          await page.reload({ waitUntil: "networkidle" });
          state.acceptDialogs = false;
          await expect(page.locator(".upload-recovery")).toBeVisible();
        }
        const recovery = await page.evaluate((key) => sessionStorage.getItem(key), recoveryStorageKey);
        assert.ok(recovery, "Unfinished uploads have recoverable session state");
        const id = JSON.parse(recovery).session.id;
        assert.equal(await uploadStatus(page, id), 200);
        await clickLogoWithConfirmation(page, state, language, false);
        await expect(page.locator(".settings-row textarea")).toHaveValue(`LOCAL TEST note ${language}`);
        await expect(page.locator(".settings-row select")).toHaveValue("7");
        assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), recoveryStorageKey), recovery);
        if (mode === "recovery") await expect(page.locator(".upload-recovery")).toBeVisible();
        else {
          await expect(page.locator(".file-name")).toHaveText(fileName);
          await expect(page.locator(".upload-pause-toggle")).toHaveAttribute("aria-label", mode === "running" ? "Upload pausieren" : "Resume upload");
        }
        assert.deepEqual(state.requests.filter(({ method }) => method === "DELETE"), [], "Dismissing the confirmation never deletes data");
        await assertRememberedShare(page, remembered);

        if (mode !== "running") {
          state.failDelete = true;
          await clickLogoWithConfirmation(page, state, language, true);
          await expect(page.locator(".form-error")).toBeVisible();
          await expect(page.locator(".settings-row textarea")).toHaveValue(`LOCAL TEST note ${language}`);
          await expect(page.locator(".settings-row select")).toHaveValue("7");
          assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), recoveryStorageKey), recovery, "A failed deletion keeps the recovery capability");
          assert.equal(await uploadStatus(page, id), 200, "Failed deletion leaves the isolated server upload available");
          if (mode === "recovery") await expect(page.locator(".upload-recovery")).toBeVisible();
          else {
            await expect(page.locator(".file-name")).toHaveText(fileName);
            await expect(page.locator(".upload-pause-toggle")).toHaveAttribute("aria-label", "Resume upload");
          }
          await assertRememberedShare(page, remembered);
          state.failDelete = false;
        }
        await clickLogoWithConfirmation(page, state, language, true);
        await assertEmptyTransfer(page);
        await assertRememberedShare(page, remembered);
        assert.equal(await uploadStatus(page, id), 404, "Confirmed reset really removed the unfinished server upload");
        assert.ok(state.requests.some(({ method, pathname }) => method === "DELETE" && pathname === `/api/uploads/${id}`));
        assert.ok(state.requests.some(({ method, pathname }) => method === "DELETE" && pathname === `/api/transfers/${id}/manage`), "Cancellation also checks the separate completed-share cleanup capability");
      });
    }

    for (const profile of [
      { label: "desktop", width: 1280, height: 900, touch: false },
      { label: "wide desktop", width: 1600, height: 1000, touch: false },
      { label: "portrait tablet", width: 768, height: 1024, touch: true },
      { label: "narrow fine pointer", width: 390, height: 844, touch: false },
      { label: "portrait touch", width: 390, height: 844, touch: true },
      { label: "landscape touch", width: 844, height: 390, touch: true },
    ]) {
      await context.test(`${profile.label}: readable controls, enabled zoom, and visible saved-section separation`, async (subtest) => {
        const { page } = await openLocalPage(subtest, browser, baseUrl, {
          viewport: { width: profile.width, height: profile.height },
          screen: { width: profile.width, height: profile.height },
          isMobile: profile.touch,
          hasTouch: profile.touch,
        });
        await seedLocalRememberedShare(page, baseUrl);
        const layout = await page.evaluate((selector) => {
          const section = document.querySelector(selector);
          const grid = document.querySelector(".hero-grid");
          const sectionRect = section.getBoundingClientRect();
          const gridRect = grid.getBoundingClientRect();
          return {
            coarse: matchMedia("(any-pointer: coarse)").matches,
            fonts: [...document.querySelectorAll(".settings-row select, .settings-row textarea")].map((element) => parseFloat(getComputedStyle(element).fontSize)),
            gap: sectionRect.top - gridRect.bottom,
            leftOffset: sectionRect.left - document.querySelector(".transfer-card").getBoundingClientRect().left,
            rightWithinGrid: sectionRect.right >= gridRect.left - 1 && sectionRect.right <= gridRect.right + 1,
            margin: parseFloat(getComputedStyle(section).marginTop),
            viewport: document.querySelector('meta[name="viewport"]')?.content ?? "",
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        }, savedSection);
        assert.equal(layout.coarse, profile.touch);
        assert.equal(layout.fonts.length, 2);
        if (profile.touch || profile.width <= 620) {
          assert.ok(layout.fonts.every((size) => size >= 16), `Editable control text must be at least 16px: ${layout.fonts}`);
        }
        const expectedGap = profile.width <= 600 ? 32 : 48;
        assert.equal(layout.margin, expectedGap);
        assert.ok(Math.abs(layout.gap - expectedGap) < 1, `Expected a physical ${expectedGap}px gap below the hero grid, got ${layout.gap}px`);
        assert.ok(Math.abs(layout.leftOffset) <= 1, `Saved section must align with the upload card; offset is ${layout.leftOffset}px`);
        assert.equal(layout.rightWithinGrid, true, "Saved section's right edge stays within the hero grid");
        const viewport = Object.fromEntries(layout.viewport.toLowerCase().split(",").map((part) => part.trim().split("=").map((value) => value.trim())));
        assert.ok(!["no", "0"].includes(viewport["user-scalable"]), "Pinch zoom must not be disabled");
        assert.ok(viewport["maximum-scale"] === undefined || Number(viewport["maximum-scale"]) > 1, "Viewport must permit zooming in");
        assert.equal(layout.overflow, false, "Larger input fonts do not create horizontal overflow");
      });
    }
  });
}
