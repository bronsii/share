import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startNextTestServer } from "./next-test-server.mjs";

const SITE_URL = "https://sendebude.de";
const OG_IMAGE_URL = `${SITE_URL}/og.png`;
const GOOGLE_SITE_VERIFICATION = "kKxsG0tD3_gn0ibh0Z6r5D3b2-W5SIzcEw7ymq6SaBw";
const BOT_HEADERS = {
  "Accept-Language": "de",
  "User-Agent": "facebookexternalhit/1.1",
  "X-Forwarded-Host": "evil.example",
  "X-Forwarded-Proto": "http",
};

function documentHead(html) {
  const match = /<head>([\s\S]*?)<\/head>/iu.exec(html);
  assert.ok(match, "HTML-Antwort muss einen vollständigen head enthalten");
  return match[1];
}

function openingTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "giu"))].map((match) => match[0]);
}

function attribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escapedName}=(['"])(.*?)\\1`, "iu").exec(tag)?.[2] ?? null;
}

function tagsWithAttributes(html, name, expectedAttributes) {
  return openingTags(html, name).filter((tag) => Object.entries(expectedAttributes)
    .every(([attributeName, value]) => attribute(tag, attributeName) === value));
}

function singleAttribute(html, tagName, identifyingAttributes, valueAttribute) {
  const tags = tagsWithAttributes(html, tagName, identifyingAttributes);
  assert.equal(tags.length, 1, `${tagName} mit ${JSON.stringify(identifyingAttributes)} muss genau einmal vorkommen`);
  const value = attribute(tags[0], valueAttribute);
  assert.notEqual(value, null, `${valueAttribute} fehlt auf ${tags[0]}`);
  return value;
}

function directiveIncludes(value, directive) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(directive);
}

test("SEO-Ausgaben verwenden feste Produktions-URLs und schützen nicht öffentliche Seiten", { timeout: 30_000 }, async (context) => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "sendebude-seo-test-"));
  const { request, output } = await startNextTestServer(context, {
    env: { SHARED_ROOT: sharedRoot },
    cleanup: () => rm(sharedRoot, { recursive: true, force: true }),
  });

  const publicPages = [
    ["/", SITE_URL],
    ["/datenschutz?utm_source=test", `${SITE_URL}/datenschutz`],
    ["/impressum", `${SITE_URL}/impressum`],
    ["/nutzungsbedingungen", `${SITE_URL}/nutzungsbedingungen`],
  ];

  for (const [route, expectedUrl] of publicPages) {
    const response = await request(route, { headers: BOT_HEADERS });
    const html = await response.text();
    assert.equal(response.status, 200, `${route} muss erreichbar sein\n${output()}`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/iu);
    assert.equal(directiveIncludes(response.headers.get("x-robots-tag"), "noindex"), false, `${route} darf im HTTP-Header nicht noindex sein`);

    const head = documentHead(html);
    assert.equal(head.includes("evil.example"), false, `${route} darf keine vom Client vorgegebene Domain ausgeben`);
    assert.equal(singleAttribute(head, "link", { rel: "canonical" }, "href"), expectedUrl);
    assert.equal(singleAttribute(head, "meta", { property: "og:url" }, "content"), expectedUrl);
    assert.equal(singleAttribute(head, "meta", { property: "og:image" }, "content"), OG_IMAGE_URL);
    assert.equal(singleAttribute(head, "meta", { name: "twitter:image" }, "content"), OG_IMAGE_URL);
    assert.equal(singleAttribute(head, "meta", { name: "google-site-verification" }, "content"), GOOGLE_SITE_VERIFICATION);

    const robotsTags = tagsWithAttributes(head, "meta", { name: "robots" });
    for (const robotsTag of robotsTags) {
      const content = attribute(robotsTag, "content");
      assert.equal(directiveIncludes(content, "noindex"), false, `${route} darf nicht noindex sein`);
      assert.equal(directiveIncludes(content, "nofollow"), false, `${route} darf nicht nofollow sein`);
    }
  }

  for (const route of ["/verwaltung", "/t/fake"]) {
    const response = await request(route, { headers: BOT_HEADERS });
    const html = await response.text();
    const head = documentHead(html);
    assert.equal(response.status, 200, `${route} muss eine kontrollierte HTML-Seite liefern\n${output()}`);
    assert.equal(directiveIncludes(response.headers.get("x-robots-tag"), "noindex"), true, `${route} braucht X-Robots-Tag: noindex`);
    const robots = singleAttribute(head, "meta", { name: "robots" }, "content");
    assert.equal(directiveIncludes(robots, "noindex"), true, `${route} braucht ein noindex-Meta-Tag`);
    assert.equal(singleAttribute(head, "meta", { property: "og:image" }, "content"), OG_IMAGE_URL);
    assert.equal(singleAttribute(head, "meta", { name: "twitter:image" }, "content"), OG_IMAGE_URL);
    assert.equal(singleAttribute(head, "meta", { name: "google-site-verification" }, "content"), GOOGLE_SITE_VERIFICATION);
    assert.equal(tagsWithAttributes(head, "link", { rel: "canonical" }).length, 0, `${route} darf kein Canonical erhalten`);
  }

  const englishPrivatePage = await request("/t/fake", {
    headers: { ...BOT_HEADERS, "Accept-Language": "en" },
  });
  assert.match(documentHead(await englishPrivatePage.text()), /<title>Private share \| Sendebude<\/title>/u);

  const robotsResponse = await request("/robots.txt", { headers: BOT_HEADERS });
  const robots = (await robotsResponse.text()).replaceAll("\r\n", "\n");
  assert.equal(robotsResponse.status, 200, output());
  assert.match(robotsResponse.headers.get("content-type") ?? "", /^text\/plain\b/iu);
  assert.match(robots, /^User-Agent: \*$/mu);
  assert.match(robots, /^Allow: \/$/mu);
  assert.match(robots, /^Sitemap: https:\/\/sendebude\.de\/sitemap\.xml$/mu);
  assert.deepEqual(
    [...robots.matchAll(/^Disallow:\s*(.+)$/gmu)].map((match) => match[1].trim()),
    ["/api/"],
    "Nur API-Routen dürfen per robots.txt gesperrt sein; private HTML-Seiten müssen für noindex crawlbar bleiben",
  );

  const sitemapResponse = await request("/sitemap.xml", { headers: BOT_HEADERS });
  const sitemap = await sitemapResponse.text();
  assert.equal(sitemapResponse.status, 200, output());
  assert.match(sitemapResponse.headers.get("content-type") ?? "", /^application\/xml\b/iu);
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]),
    [SITE_URL, `${SITE_URL}/datenschutz`, `${SITE_URL}/impressum`, `${SITE_URL}/nutzungsbedingungen`],
  );
  assert.equal(sitemap.includes("evil.example"), false);
  assert.doesNotMatch(sitemap, /\/(?:api|t|verwaltung)(?:\/|<)/u);

  const imageResponse = await request("/og.png", { headers: BOT_HEADERS });
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type") ?? "", /^image\/png\b/iu);
});
