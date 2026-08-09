import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Shell only. Convex is realtime and the brief, mail and calendar are live —
 * a cached brief from yesterday rendered as today's is worse than an honest
 * empty state, and the Glow Means Live doctrine forbids the screen implying
 * currency it does not have. These guards are what stop a future edit from
 * "helpfully" caching data. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const sw = read("../public/sw.js");
const shell = read("../src/components/AppShell.tsx");
const config = read("../next.config.ts");

test("the worker caches a shell, not data", () => {
  assert.match(sw, /caches\.open/, "uses the Cache API");
  assert.ok(!/\/api\//.test(sw), "must never cache an API route — data is live, always");
  assert.ok(!/convex/i.test(sw), "must never cache Convex traffic");
});

test("only navigations are intercepted", () => {
  assert.match(
    sw,
    /if \(request\.mode !== ["']navigate["']\) return;/,
    "everything that is not a navigation goes to the network untouched",
  );
});

/* Network-first, not cache-first. A cache-first shell would serve a stale
 * build after every deploy until the worker updated. */
test("the network is tried before the cache", () => {
  const handler = sw.slice(sw.indexOf('addEventListener("fetch"'));
  assert.ok(
    handler.indexOf("fetch(request)") < handler.indexOf("caches.match"),
    "fetch must be attempted before falling back to the cached shell",
  );
});

test("old caches are cleaned up on activate", () => {
  assert.match(sw, /activate/, "has an activate handler");
  assert.match(sw, /caches\.delete/, "deletes superseded caches");
});

test("the worker is actually registered, or it does nothing at all", () => {
  const reg = read("../src/components/ServiceWorker.tsx");
  assert.match(reg, /navigator\.serviceWorker\.register\(["']\/sw\.js["']\)/);
  assert.match(reg, /catch/, "registration failure must never break the app");
  assert.match(shell, /<ServiceWorker \/>/, "AppShell mounts it");
});

test("sw.js is served uncached, or a bad worker outlives its fix", () => {
  assert.match(config, /source: ["']\/sw\.js["']/, "next.config.ts headers /sw.js");
  const rule = config.slice(config.indexOf('"/sw.js"'));
  assert.match(rule.slice(0, 600), /no-cache|no-store|max-age=0/, "sw.js is not cached");
});
