import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks, firstLink } from "../src/lib/linkify.ts";

test("plain text yields one text part", () => {
  assert.deepEqual(splitLinks("no links here"), [
    { type: "text", value: "no links here" },
  ]);
});

test("a trailing url becomes its own link part", () => {
  assert.deepEqual(
    splitLinks("Recipes worth trying — https://www.tasteofhome.com/collection/vintage-recipes"),
    [
      { type: "text", value: "Recipes worth trying — " },
      {
        type: "link",
        value: "https://www.tasteofhome.com/collection/vintage-recipes",
      },
    ]
  );
});

test("text after a url is kept", () => {
  assert.deepEqual(splitLinks("see https://example.com/a for more"), [
    { type: "text", value: "see " },
    { type: "link", value: "https://example.com/a" },
    { type: "text", value: " for more" },
  ]);
});

test("multiple urls all become links", () => {
  const parts = splitLinks("https://a.com/one and https://b.com/two");
  assert.deepEqual(
    parts.filter((p) => p.type === "link").map((p) => p.value),
    ["https://a.com/one", "https://b.com/two"]
  );
});

test("trailing sentence punctuation stays out of the url", () => {
  // A period glued to the href 404s — the commonest linkify bug.
  assert.deepEqual(splitLinks("read https://example.com/post."), [
    { type: "text", value: "read " },
    { type: "link", value: "https://example.com/post" },
    { type: "text", value: "." },
  ]);
});

test("a url wrapped in parentheses excludes the closing paren", () => {
  const parts = splitLinks("(https://example.com/x)");
  assert.equal(
    parts.find((p) => p.type === "link")?.value,
    "https://example.com/x"
  );
});

test("balanced parens inside a url are preserved", () => {
  const url = "https://en.wikipedia.org/wiki/Kolache_(pastry)";
  assert.equal(firstLink(`see ${url}`), url);
});

test("http and https both match; other schemes do not", () => {
  assert.equal(firstLink("http://plain.example/x"), "http://plain.example/x");
  assert.equal(firstLink("ftp://nope.example/x"), null);
  assert.equal(firstLink("javascript:alert(1)"), null);
});

test("firstLink returns null when there is no url", () => {
  assert.equal(firstLink("nothing to open"), null);
});

test("empty text yields no parts", () => {
  assert.deepEqual(splitLinks(""), []);
});
