import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, cleanByline } from "../src/lib/readerTitle.ts";

test("strips a trailing site name that matches the site", () => {
  assert.equal(
    cleanTitle("Top 50 Fan-Favorite Recipes | Food Network", {
      siteName: "Food Network",
      hostname: "www.foodnetwork.com",
    }),
    "Top 50 Fan-Favorite Recipes"
  );
});

test("strips a trailing site name recognised from the hostname alone", () => {
  // Escalated HTML has no <head>, so Readability reports no siteName.
  assert.equal(
    cleanTitle("Top 50 Fan-Favorite Recipes | Food Network", {
      siteName: null,
      hostname: "www.foodnetwork.com",
    }),
    "Top 50 Fan-Favorite Recipes"
  );
});

test("handles dash and en-dash separators", () => {
  const opts = { siteName: null, hostname: "urbanmilwaukee.com" };
  assert.equal(cleanTitle("Oak Leaf Trail - Urban Milwaukee", opts), "Oak Leaf Trail");
  assert.equal(cleanTitle("Oak Leaf Trail – Urban Milwaukee", opts), "Oak Leaf Trail");
});

test("leaves a title whose tail is not the site", () => {
  assert.equal(
    cleanTitle("Cats | Dogs", { siteName: "Food Network", hostname: "www.foodnetwork.com" }),
    "Cats | Dogs"
  );
});

test("never strips down to nothing", () => {
  assert.equal(
    cleanTitle("Food Network", { siteName: "Food Network", hostname: "www.foodnetwork.com" }),
    "Food Network"
  );
});

test("a byline of only a label is not a byline", () => {
  for (const junk of ["By:", "By: ", "by", " By ", "", "   "]) {
    assert.equal(cleanByline(junk), null, `${JSON.stringify(junk)} should be null`);
  }
});

test("a real byline survives, and loses its label", () => {
  assert.equal(cleanByline("By: Graham Kilmer"), "Graham Kilmer");
  assert.equal(cleanByline("Graham Kilmer"), "Graham Kilmer");
});

test("a null byline stays null", () => {
  assert.equal(cleanByline(null), null);
  assert.equal(cleanByline(undefined), null);
});
