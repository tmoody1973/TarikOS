import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import manifest from "../src/app/manifest.ts";

const at = (p: string) => new URL(p, import.meta.url);

test("the manifest makes the app installable", () => {
  const m = manifest();
  assert.equal(m.display, "standalone", "installed app has no browser chrome");
  assert.equal(m.start_url, "/");
  assert.ok((m.name ?? "").length > 0);
  assert.ok((m.short_name ?? "").length > 0);
});

test("the splash matches the bridge, not the browser default", () => {
  const m = manifest();
  assert.equal(m.background_color, "#050608", "space black");
  assert.equal(m.theme_color, "#050608");
});

test("icons cover the sizes a home screen needs", () => {
  const sizes = (manifest().icons ?? []).map((i) => i.sizes);
  assert.ok(sizes.includes("512x512"), "512 for the splash");
  assert.ok(sizes.includes("192x192"), "192 for the home screen");
});

/* The plan declared ONE file at both sizes — a manifest that says a 512px
 * image is 192x192 is simply lying, and browsers pick by declared size. Each
 * entry gets its own real file, and the file's actual pixel dimensions are
 * read off disk rather than trusted. */
test("every declared icon exists at the size it claims", () => {
  for (const icon of manifest().icons ?? []) {
    const path = at(`../public${icon.src}`);
    assert.ok(statSync(path).size > 0, `${icon.src} exists and is not empty`);

    const png = readFileSync(path);
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${icon.src} is a PNG`);
    // IHDR width/height are big-endian uint32 at byte 16 and 20.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const [declaredW, declaredH] = String(icon.sizes).split("x").map(Number);
    assert.equal(width, declaredW, `${icon.src} width`);
    assert.equal(height, declaredH, `${icon.src} height`);
    assert.equal(width, height, `${icon.src} must be square`);
  }
});

test("Next's metadata icons are real files too", () => {
  for (const [file, expected] of [
    ["../src/app/icon.png", 512],
    ["../src/app/apple-icon.png", 180],
  ] as const) {
    const png = readFileSync(at(file));
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${file} is a PNG`);
    assert.equal(png.readUInt32BE(16), expected, `${file} width`);
    assert.equal(png.readUInt32BE(20), expected, `${file} height`);
  }
});
