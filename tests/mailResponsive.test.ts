import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* MOO-532. The reading pane was `hidden min-w-0 flex-1 flex-col lg:flex`, so
 * below lg a phone could LIST mail but not READ it — tapping a thread
 * highlighted the row and showed nothing. Same class of bug as the missing
 * spine: a feature that simply did not exist below lg.
 *
 * The fix is the standard phone-mail pattern: one column at a time. The list
 * yields to the reader when a thread is open, and a back control returns.
 * Desktop keeps both side by side. */

const page = readFileSync(
  new URL("../src/app/mail/page.tsx", import.meta.url),
  "utf8",
);

test("the reading pane is no longer desktop-only", () => {
  assert.ok(
    !/className="hidden min-w-0 flex-1 flex-col lg:flex"/.test(page),
    "a phone must be able to read a thread, not just list one",
  );
});

/* Sliced on real block boundaries, not a fixed character count. A 300-char
 * window reached the className only until a comment grew above it, which made
 * these fail on correct code — and a red baseline makes every mutation result
 * meaningless. */
const block = (from: string, to: string) =>
  page.slice(page.indexOf(from), page.indexOf(to));

// "<Compose" alone matches `useState<ComposePrefill | null>` earlier in the
// file, which sliced the block backwards to an empty string — and an empty
// block fails every assertion for a reason that has nothing to do with the UI.
const readerBlock = block("{/* Reading pane", "\n      <Compose\n");
const listBlock = block("{/* Thread list", "{/* Reading pane");

test("opening a thread shows the reader below lg", () => {
  assert.match(
    readerBlock,
    /open \? "flex" : "hidden"/,
    "the reader appears exactly when a thread is open",
  );
  assert.match(readerBlock, /lg:flex/, "and always at lg and up");
});

test("the list yields to the reader on a phone, not stacked underneath", () => {
  assert.match(
    listBlock,
    /open \? "hidden lg:flex" : "flex"/,
    "one column at a time below lg",
  );
});

/* A reader you cannot get out of is a trap: below lg the list is gone while
 * it is open, so the way back has to be on screen. */
test("there is a way back to the inbox on a phone", () => {
  assert.match(readerBlock, /setOpen\(null\)/, "a control clears the selection");
  assert.match(readerBlock, /lg:hidden/, "and it is mobile-only");
});

test("the back control is reachable and labelled", () => {
  assert.match(readerBlock, /focus-visible:outline-2/, "focus ring");
  for (const line of readerBlock.split("\n")) {
    if (!/\btransition\b/.test(line)) continue;
    assert.match(
      line,
      /motion-reduce:transition-none/,
      `transition without motion-reduce: ${line.trim()}`,
    );
  }
});
