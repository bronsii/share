import assert from "node:assert/strict";
import test from "node:test";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { startHttpsTestServer } from "./https-test-server.mjs";

const browsers = { chromium, firefox, webkit };
for (const name of (process.env.TEST_BROWSERS ?? "chromium,firefox,webkit").split(",")) {
  test(`${name}: translated upload limits stay in the right-hand badge without overflow`, { timeout: 60_000 }, async (context) => {
    const { baseUrl } = await startHttpsTestServer(context);
    const browser = await browsers[name].launch({ headless: true });
    context.after(() => browser.close());
    const page = await browser.newPage({ locale: "de-DE", ignoreHTTPSErrors: true });
    await page.goto(baseUrl);
    await page.waitForLoadState("networkidle");
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [language, label] of [["EN", "max. 20 files · 5 GiB"], ["DE", "max. 20 Dateien · 5 GiB"]]) {
        await page.getByRole("button", { name: language, exact: true }).click();
        await expect(page.locator(".limit-pill")).toHaveText(label);
        await expect(page.locator(".upload-limits")).toHaveCount(0);
        const heading = await page.locator(".card-heading").boundingBox();
        const badge = await page.locator(".limit-pill").boundingBox();
        const title = await page.locator("#transfer-title").boundingBox();
        assert.ok(heading && badge && title);
        assert.ok(Math.abs(badge.x + badge.width - heading.x - heading.width) < 2, "Badge stays right-aligned");
        assert.ok(title.y >= badge.y + badge.height, "Title has its own row below the badge");
        assert.ok(badge.x >= heading.x && badge.width <= heading.width, "Badge fits inside header");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        if (process.env.TEST_SCREENSHOTS && language === "DE") {
          await page.locator(".transfer-card").screenshot({ path: `work/upload-heading-${name}-${width}.png` });
        }
      }
    }
  });
}
