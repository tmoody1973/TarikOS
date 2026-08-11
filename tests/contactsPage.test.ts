import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The /contacts page (MOO-499) against the locked design system in DESIGN.md
// and the mobile rules in the PWA spec.
//
// Source-scanned rather than rendered, the same way documentsPage and
// mailResponsive are: these are contracts about the markup, and the failures
// they catch (a page that scrolls sideways at 375px, a nav cap with no page,
// a second search implementation) are invisible in a unit test of the logic.

const PAGE = readFileSync("src/app/contacts/page.tsx", "utf8");
const CODE = PAGE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const NAV = readFileSync("src/lib/navLinks.ts", "utf8");

test("the surface claims a channel colour and uses it consistently", () => {
  // The Channel Color Rule: a new surface claims a hue before shipping.
  assert.match(NAV, /href: "\/contacts", color: "bg-salmon"/);
  assert.match(CODE, /text-salmon/);
});

test("the list yields to the card below lg rather than reflowing", () => {
  // The mobile spec calls list+detail pages "hard" and requires a real
  // single-column story. Two panes side by side at 375px gives two unusable
  // halves.
  assert.match(CODE, /hidden lg:flex/);
  assert.match(CODE, /lg:w-96/);
});

test("a card opened on a phone can be closed without a back gesture", () => {
  // The list is hidden while a card is open, so without this there is no way
  // back to it on a phone.
  assert.match(CODE, /BACK/);
  assert.match(CODE, /lg:hidden/);
});

test("search reuses the ranking the voice tool uses", () => {
  // A second implementation would let the page and Zola disagree about who
  // "Marcus" is — the same answer from two surfaces is the whole point.
  assert.match(CODE, /rankContacts/);
  assert.ok(!/\.filter\(\s*\(c\)\s*=>\s*c\.name/.test(CODE), "no hand-rolled name filter");
});

test("unreachable contacts are off by default", () => {
  // 4,033 of 4,825 have no phone and no email. Defaulting to all of them makes
  // the list 84% noise and multiplies the payload on a phone.
  assert.match(CODE, /useState\(false\)/);
  assert.match(CODE, /includeUnreachable/);
});

test("no action is offered that cannot work yet", () => {
  // Calling or texting THROUGH Zola is MOO-498/MOO-497 and does not exist. A
  // button that can never be pressed is worse than no button.
  assert.ok(!/disabled/.test(CODE), "no disabled affordances");
  assert.ok(!/send_sms|call_person/.test(CODE), "no unbuilt tool wired to the UI");
  // tel: and the mail composer are the two that do work today.
  assert.match(CODE, /href=\{`tel:/);
  assert.match(CODE, /\/mail\?compose=/);
});

test("provider text cannot push the page sideways", () => {
  // Names, orgs, numbers and addresses are all written by someone else. One
  // unbroken string moved a whole page 133px on /control.
  assert.match(CODE, /\[overflow-wrap:anywhere\]/);
  assert.match(CODE, /break-all/);
  assert.match(CODE, /truncate/);
});

test("every interactive element keeps the universal focus treatment", () => {
  const interactive = (CODE.match(/<(?:button|a|input)\b/g) ?? []).length;
  const focused = (CODE.match(/focus-visible:outline-2 focus-visible:outline-cyan-hud/g) ?? []).length;
  assert.ok(focused >= interactive - 1, `${focused} focus rings for ${interactive} controls`);
});

test("flat at rest — no resting shadow on a page with no overlay", () => {
  assert.ok(!/shadow-/.test(CODE), "the Flat-At-Rest Rule allows shadow only on the overlay layer");
});

test("panels carry the 1px panel-edge border", () => {
  // Borderless floating panels do not exist in this system. Checked per
  // className rather than by position — the house style writes the border
  // before the background, so an ordering-sensitive scan fails on correct code.
  const classNames = [...CODE.matchAll(/className=[{"`]([^"`]+)[}"`]/g)].map((m) => m[1]);
  const panels = classNames.filter((c) => /\bbg-panel\b/.test(c));
  assert.ok(panels.length > 0, "expected panel surfaces");
  for (const c of panels) {
    assert.match(c, /border-panel-edge/, `panel without its edge: ${c.slice(0, 60)}`);
  }
});

test("the search field is labelled", () => {
  assert.match(CODE, /htmlFor="contact-search"/);
  assert.match(CODE, /id="contact-search"/);
});

test("a long list is capped rather than rendering thousands of rows", () => {
  assert.match(CODE, /slice\(0, 300\)/);
  assert.match(CODE, /KEEP TYPING TO NARROW/);
});
