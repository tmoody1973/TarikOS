import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_LINKS, isActiveRoute } from "../src/lib/navLinks.ts";

test("every destination has a label, href and channel colour", () => {
  assert.equal(NAV_LINKS.length, 8);
  for (const l of NAV_LINKS) {
    assert.ok(l.label.length > 0, "label");
    assert.ok(l.href.startsWith("/"), `href: ${l.href}`);
    assert.match(l.color, /^bg-/, `colour: ${l.color}`);
  }
});

test("HOME is active only on exactly /", () => {
  assert.equal(isActiveRoute("/", "/"), true);
  assert.equal(isActiveRoute("/briefs", "/"), false);
});

test("a section is active on its own subtree", () => {
  assert.equal(isActiveRoute("/briefs", "/briefs"), true);
  assert.equal(isActiveRoute("/briefs/2026-08-09", "/briefs"), true);
  assert.equal(isActiveRoute("/mail", "/briefs"), false);
});

test("destinations are unique — a duplicate href would light two caps", () => {
  const hrefs = NAV_LINKS.map((l) => l.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
