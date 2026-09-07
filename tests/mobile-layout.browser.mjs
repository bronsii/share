import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startHttpsTestServer } from "./https-test-server.mjs";

const browsers = { chromium, webkit };
const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];
const legalPages = [
  ["/nutzungsbedingungen", { DE: "Nutzungsbedingungen", EN: "Terms of Use" }],
  ["/datenschutz", { DE: "Datenschutz", EN: "Privacy" }],
  ["/impressum", { DE: "Impressum", EN: "Legal notice" }],
];
const files = Array.from({ length: 20 }, (_, index) => ({
  name: `mobile-layout-file-${String(index + 1).padStart(2, "0")}-with-a-long-name.txt`,
  mimeType: "text/plain",
  buffer: Buffer.from(`Local-only mobile layout fixture ${index + 1}`),
}));

async function mobilePage(context, browser, baseUrl, viewport) {
  const browserContext = await browser.newContext({
    viewport,
    screen: viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "de-DE",
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const forbiddenRequests = [];
  // Fail closed: fixtures stay in the browser and this test cannot upload or
  // contact the live site, even if selection/removal accidentally regresses.
  await browserContext.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== baseUrl || !["GET", "HEAD"].includes(request.method())) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const page = await browserContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.after(async () => {
    try {
      await page.waitForLoadState("networkidle");
      assert.deepEqual(forbiddenRequests, [], "Only read-only requests to the isolated local server are allowed");
      assert.deepEqual(errors, [], "No client-side errors during the mobile flow");
    } finally {
      await browserContext.close();
    }
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "Use a real coarse-pointer emulation profile");
  return page;
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Document fits the mobile viewport");
}

async function assertHeadingTextFits(page, title) {
  const heading = page.locator(".privacy-shell h1");
  await expect.poll(async () => (await heading.textContent()).replaceAll("\u00ad", "")).toBe(title);
  await page.evaluate(() => document.fonts.ready);
  const layout = await heading.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left);
    let right = Math.min(window.innerWidth, box.right);
    // overflow-x:hidden can hide text without increasing document.scrollWidth.
    // Inspect actual text fragments and any horizontal clipping ancestors.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)) {
        const bounds = ancestor.getBoundingClientRect();
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const fragments = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      fragments.push(...Array.from(range.getClientRects(), (rect) => ({ left: rect.left, right: rect.right, width: rect.width })));
    }
    return { left, right, fragments: fragments.filter((rect) => rect.width > 0) };
  });
  assert.ok(layout.fragments.length > 0, `${title}: heading has rendered text fragments`);
  for (const fragment of layout.fragments) {
    assert.ok(fragment.left >= layout.left - 1 && fragment.right <= layout.right + 1,
      `${title}: text fragment ${JSON.stringify(fragment)} exceeds visible heading bounds ${layout.left}–${layout.right}`);
  }
  await assertNoHorizontalOverflow(page);
}

async function assertTouchTargets(page, selector, count) {
  const targets = page.locator(selector);
  await expect(targets).toHaveCount(count);
  const bounds = await targets.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const cell = element.closest(".file-actions")?.getBoundingClientRect();
    return {
      label: element.getAttribute("aria-label") ?? element.textContent,
      width: rect.width,
      height: rect.height,
      fitsCell: !cell || (rect.left >= cell.left - 1 && rect.right <= cell.right + 1),
    };
  }));
  for (const target of bounds) {
    assert.ok(target.width >= 43.99 && target.height >= 43.99,
      `${selector} (${target.label}): expected at least 44×44 CSS px, got ${target.width}×${target.height}`);
    assert.equal(target.fitsCell, true, `${selector} (${target.label}): delete target fits its grid cell`);
  }
}

for (const name of (process.env.TEST_BROWSERS ?? "chromium,webkit").split(",").map((value) => value.trim()).filter(Boolean)) {
  assert.ok(name in browsers || name === "firefox", `Unknown TEST_BROWSERS entry: ${name}`);
  test(`${name}: mobile legal headings and local file selection`, {
    timeout: 120_000,
    skip: name === "firefox" ? "Playwright Firefox does not support isMobile emulation" : false,
  }, async (context) => {
    const { baseUrl } = await startHttpsTestServer(context);
    const browser = await browsers[name].launch({
      headless: true,
      ...(name === "webkit" && process.env.TEST_WEBKIT_EXECUTABLE ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE } : {}),
    });
    context.after(() => browser.close());
    for (const viewport of viewports) {
      const size = `${viewport.width}×${viewport.height}`;
      await context.test(`${size}: German and English legal heading text is not clipped`, async (subtest) => {
        const page = await mobilePage(subtest, browser, baseUrl, viewport);
        for (const [pathname, titles] of legalPages) {
          await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
          for (const language of ["DE", "EN"]) {
            await page.getByRole("button", { name: language, exact: true }).tap();
            await assertHeadingTextFits(page, titles[language]);
            if (process.env.TEST_SCREENSHOTS && viewport.width === 320 && language === "DE" && pathname === "/nutzungsbedingungen") {
              await page.screenshot({ path: `work/mobile-layout-${name}-terms-320.png` });
            }
          }
        }
      });
      await context.test(`${size}: 44px touch targets and 20-file chooser/removal stay local`, async (subtest) => {
        const page = await mobilePage(subtest, browser, baseUrl, viewport);
        for (const language of ["DE", "EN"]) {
          await page.goto(baseUrl, { waitUntil: "networkidle" });
          await page.waitForFunction(() => {
            const input = document.querySelector('input[type="file"]');
            return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
          });
          await page.getByRole("button", { name: language, exact: true }).tap();
          await assertTouchTargets(page, ".language-switch button", 2);
          await assertTouchTargets(page, ".admin-lock-link", 1);
          const chooserPending = page.waitForEvent("filechooser");
          await page.locator(".dropzone").tap();
          const chooser = await chooserPending;
          assert.equal(chooser.isMultiple(), true);
          await chooser.setFiles(files);
          await expect(page.locator(".file-row")).toHaveCount(20);
          await expect(page.locator(".file-name")).toHaveText(files.map((file) => file.name));
          // File removal lives at .file-actions button; there is no .remove-button.
          await assertTouchTargets(page, ".file-actions button", 20);
          assert.equal(await page.locator(".file-list").evaluate((element) => element.scrollHeight > element.clientHeight), true, "Twenty files use the scrollable list");
          await assertNoHorizontalOverflow(page);
          if (process.env.TEST_SCREENSHOTS && viewport.width === 320 && language === "DE") {
            await page.locator(".transfer-card").screenshot({ path: `work/mobile-layout-${name}-files-320.png` });
          }
          await page.locator(".file-actions button").first().tap();
          await expect(page.locator(".file-row")).toHaveCount(19);
          await expect(page.locator(".file-name")).toHaveText(files.slice(1).map((file) => file.name));
          await page.locator(".file-actions button").last().tap();
          await expect(page.locator(".file-row")).toHaveCount(18);
          await expect(page.locator(".file-name")).toHaveText(files.slice(1, -1).map((file) => file.name));
          await expect(page.getByRole("checkbox")).not.toBeChecked();
          await expect(page.locator(".share-link")).toHaveCount(0);
          await assertNoHorizontalOverflow(page);
        }
        for (const [pathname] of legalPages) {
          await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
          await assertTouchTargets(page, ".language-switch button", 2);
          await assertNoHorizontalOverflow(page);
        }
      });
    }
  });
}
