import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAV_LINKS } from "../src/lib/navLinks.ts";

/* The /documents page is where a link minted by voice — in a moment, from a
 * phone — can actually be seen and killed. Its risks are not layout:
 *
 *  1. A presigned URL rendered into the HTML outlives the page. It ends up in
 *     view-source, in a screenshot, in a shared tab. The one in the markup is
 *     not revocable; the one minted on click is gone in five minutes.
 *  2. Document titles come from brief titles and spoken research queries —
 *     text the app did not author — which is the exact class that pushed
 *     /control sideways by 133px at 375px.
 *
 * Source-text guards, like navShared: this project has no DOM renderer, so
 * each is mutation-tested and the page is also looked at narrow. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const page = read("../src/app/documents/page.tsx");
const download = read("../src/app/api/documents/download/route.ts");
const proxy = read("../src/proxy.ts");

test("the page never mints or embeds a presigned URL", () => {
  assert.ok(
    !/getPresignedDownloadUrl|X-Amz|r2\b/.test(page),
    "presigning belongs on the server; a URL in the markup outlives the page",
  );
  assert.match(
    page,
    /\/api\/documents\/download/,
    "download goes through a route that mints one per click",
  );
});

test("the download route is behind Clerk", () => {
  // Every other document surface is owner-only. /f/<slug> is the single
  // deliberate exception, and it is deliberate because a share link was
  // confirmed out loud first.
  // The route list itself, comments stripped. Two bugs in the first version:
  // indexOf("]") searched from the top of the file rather than from the
  // matcher, and the comment above it explains that /f is "the shared-document
  // route" — so the word appeared in the prose, not in the list.
  const code = proxy.replace(/\/\/.*$/gm, "");
  const open = code.indexOf("createRouteMatcher([");
  assert.ok(open > -1, "proxy must declare its public routes in one place");
  const list = code.slice(open, code.indexOf("]", open));
  assert.ok(
    !/documents/.test(list),
    "/api/documents must not be listed as a public route",
  );
  assert.match(
    download,
    /getPresignedDownloadUrl\(/,
    "the route mints the URL itself",
  );
  assert.match(download, /auth|currentUser|isOwner/, "and checks the session");
});

/* A lookback window from a render site, borrowed from pageOverflow: JSX nests
 * too freely to find the enclosing tag by brace-matching, and asserting the
 * class exists *somewhere in the file* proved nothing — removing it from the
 * title still passed, because the filename line below it kept its copy. */
function context(src: string, needle: string, back = 300): string {
  const i = src.indexOf(needle);
  assert.ok(i > -1, `expected to find ${needle}`);
  return src.slice(Math.max(0, i - back), i);
}

test("titles and filenames wrap instead of widening the page", () => {
  // A brief title or a spoken research query can be arbitrarily long and
  // unbroken. Measured on /control: 133px of horizontal page overflow.
  for (const needle of ["{doc.title}", "{doc.filename}", "{link.slug}"]) {
    assert.match(
      context(page, needle),
      /\[overflow-wrap:anywhere\]/,
      `${needle} is text the app did not author and must wrap`,
    );
  }
});

test("share state is shown per document, not just the file list", () => {
  // The whole point of the page: seeing that a link exists and is live is
  // what makes revoking possible.
  for (const needle of ["REVOKED", "EXPIRED", "downloadCount", "expiresAt"]) {
    assert.ok(page.includes(needle), `share state must show ${needle}`);
  }
  // The real mutation, not any local binding that happens to share the name —
  // stubbing `revokeShare` to a no-op passed the looser check.
  assert.match(
    page,
    /api\.documents\.revokeShare/,
    "revoking must be reachable from here",
  );
});

test("the page reads share state from the shared rules, not its own copy", () => {
  // checkShareAccess already decides what dead means. A second opinion in the
  // UI would drift from the one /f/[slug] enforces, and the page would show a
  // link as live that the route refuses. Pinned inside linkState, because a
  // call elsewhere in the file left a hand-rolled verdict passing.
  const state = page.slice(
    page.indexOf("function linkState"),
    page.indexOf("function DocumentsInner"),
  );
  assert.ok(state.length > 100, "linkState sliced empty — fix the slice");
  assert.match(state, /checkShareAccess\(link, now\)/);
  assert.ok(
    !/link\.revoked\s*(?:\?|&&|\|\|)/.test(state),
    "no second opinion about what dead means",
  );
});

test("DOCS is in the one destination list", () => {
  const docs = NAV_LINKS.find((l) => l.href === "/documents");
  assert.ok(docs, "the page must be reachable from the nav on both devices");
  assert.match(docs.color, /^bg-/, "and claim a channel colour");
});
