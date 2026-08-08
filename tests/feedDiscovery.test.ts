import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSiteUrl,
  extractFeedLinks,
  feedCandidatePaths,
} from "../src/lib/feedDiscovery.ts";

// ---- normalizeSiteUrl ----

test("bare domain becomes https URL", () => {
  assert.equal(normalizeSiteUrl("theverge.com"), "https://theverge.com/");
});

test("existing scheme and path are preserved", () => {
  assert.equal(
    normalizeSiteUrl("https://current.org/feed/"),
    "https://current.org/feed/",
  );
});

test("garbage input returns null", () => {
  assert.equal(normalizeSiteUrl("not a url at all !!"), null);
  assert.equal(normalizeSiteUrl(""), null);
});

// ---- extractFeedLinks ----

test("rel=alternate RSS and Atom link tags are extracted in order", () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" title="Main" href="https://site.test/feed/">
    <link rel="alternate" type="application/atom+xml" href="/atom.xml">
    <link rel="stylesheet" href="/style.css">
  </head><body></body></html>`;
  assert.deepEqual(extractFeedLinks(html, "https://site.test/"), [
    "https://site.test/feed/",
    "https://site.test/atom.xml",
  ]);
});

test("relative hrefs resolve against the page URL", () => {
  const html = `<link rel="alternate" type="application/rss+xml" href="feed.xml">`;
  assert.deepEqual(extractFeedLinks(html, "https://site.test/blog/"), [
    "https://site.test/blog/feed.xml",
  ]);
});

test("page with no feed links returns empty list", () => {
  assert.deepEqual(extractFeedLinks("<html><head></head></html>", "https://x.test/"), []);
});

// ---- feedCandidatePaths ----

test("candidate probe paths are rooted at the site origin", () => {
  const paths = feedCandidatePaths("https://site.test/some/page");
  assert.ok(paths.includes("https://site.test/feed"));
  assert.ok(paths.includes("https://site.test/rss"));
  assert.ok(paths.includes("https://site.test/atom.xml"));
  assert.ok(paths.every((p) => p.startsWith("https://site.test/")));
});
