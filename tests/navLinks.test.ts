import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { NAV_LINKS, isActiveRoute } from "../src/lib/navLinks.ts";

test("every destination has a label, href and channel colour", () => {
  assert.equal(NAV_LINKS.length, 10);
  for (const l of NAV_LINKS) {
    assert.ok(l.label.length > 0, "label");
    assert.ok(l.href.startsWith("/"), `href: ${l.href}`);
    assert.match(l.color, /^bg-/, `colour: ${l.color}`);
  }
});

test("every destination is reachable as a real page", () => {
  // The rail and the spine both render from this list, so an entry with no
  // page is a nav cap that goes nowhere on every device at once.
  for (const l of NAV_LINKS) {
    if (l.href === "/") continue;
    assert.ok(
      existsSync(`src/app${l.href}/page.tsx`),
      `no page for nav entry ${l.label} (${l.href})`,
    );
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
