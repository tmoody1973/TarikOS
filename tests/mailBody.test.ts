import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPart,
  messageBody,
  previewSnippet,
  textToHtml,
} from "../src/lib/mail.ts";

/* Message-body rendering (MOO-538). Every fixture below mirrors a shape probed
 * live against the real inbox on 2026-08-09 (25 messages, work-gmail):
 *
 *   - messageHtml / htmlBody / payload.htmlBody / snippet are NEVER present.
 *   - messageText is always present and is sometimes the raw HTML source.
 *   - payload always carries a text/html part, at depth 0..3.
 *   - preview.body is always present, entity-encoded, zero-width padded.
 *
 * The bug Tarik reported was two faces of one cause: we never read the
 * payload's text/html part, which is the thing Gmail renders. */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// Mesh Team "Weekly Digest" — payload IS text/html at depth 0, and
// messageText carries the same markup as a string. Rendered as escaped text
// this showed Tarik `<!doctype html>` on screen.
const MESH_HTML = '<!doctype html><html lang="en"><body><p>Weekly digest</p></body></html>';
const meshMessage = {
  subject: "Weekly Digest - August 09, 2026",
  messageText: MESH_HTML,
  preview: { body: "WEEKLY DIGEST Your Week Ahead Hi Tarik" },
  payload: { mimeType: "text/html", body: { data: b64(MESH_HTML) } },
};

// Great Lakes Distillery — multipart/alternative. messageText is 10,949 chars
// with ZERO newlines (measured), which is why pre-wrap rendered a wall of
// text; the real markup was sitting in the text/html sibling all along.
const GLD_HTML = "<html><body><h1>August 2026</h1><p>Hello Tarik Moody,</p></body></html>";
const gldMessage = {
  subject: "Reminder: The Latest From GLD",
  messageText: "Email from Great Lakes Distillery, LLC August 2026 Hello Tarik Moody, ",
  preview: { body: "August 2026 Hello Tarik Moody, August is here" },
  payload: {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: b64("Email from GLD\n\nHello Tarik") } },
      { mimeType: "text/html", body: { data: b64(GLD_HTML) } },
    ],
  },
};

// Eventbrite — multipart/mixed > multipart/alternative > text/html, i.e. two
// levels down. The old one-level finder missed exactly this.
const NESTED_HTML = "<p>Your order is confirmed.</p>";
const nestedMessage = {
  subject: "Order Notification",
  messageText: "Eventbrite\r\n\r\nYour order is confirmed.",
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64("Your order is confirmed.") } },
          { mimeType: "text/html", body: { data: b64(NESTED_HTML) } },
        ],
      },
      { mimeType: "application/pdf" },
    ],
  },
};

// ---- findPart ----

test("finds a text/html part at the top level", () => {
  assert.equal(findPart(meshMessage.payload, "text/html")?.mimeType, "text/html");
});

test("finds text/html one level down, under multipart/alternative", () => {
  const hit = findPart(gldMessage.payload, "text/html");
  assert.equal(Buffer.from(hit?.body?.data ?? "", "base64url").toString(), GLD_HTML);
});

test("finds text/html two levels down, under multipart/mixed", () => {
  const hit = findPart(nestedMessage.payload, "text/html");
  assert.equal(Buffer.from(hit?.body?.data ?? "", "base64url").toString(), NESTED_HTML);
});

test("returns undefined when no part of that type exists", () => {
  assert.equal(findPart(nestedMessage.payload, "text/calendar"), undefined);
  assert.equal(findPart(undefined, "text/html"), undefined);
});

// ---- messageBody ----

test("a wall-of-text newsletter renders as its real HTML", () => {
  const body = messageBody(gldMessage);
  assert.equal(body.isHtml, true);
  assert.equal(body.html, GLD_HTML);
});

test("a raw-HTML messageText renders as HTML, never as escaped source", () => {
  const body = messageBody(meshMessage);
  assert.equal(body.isHtml, true);
  assert.ok(!body.html.includes("&lt;"), "source must not be escaped into view");
});

test("a nested multipart message finds its HTML part", () => {
  assert.equal(messageBody(nestedMessage).html, NESTED_HTML);
});

test("our own HTML drafts still come back as HTML", () => {
  // Composio returns our single-part drafts with the HTML in messageText and
  // no payload at all (probed 2026-08-07).
  const draft = { messageText: "<p>Draft body</p>" };
  const body = messageBody(draft);
  assert.equal(body.isHtml, true);
  assert.equal(body.html, "<p>Draft body</p>");
});

test("a plain-text-only message becomes real paragraphs", () => {
  const plain = {
    payload: {
      mimeType: "text/plain",
      body: { data: b64("First para.\n\nSecond para.") },
    },
  };
  const body = messageBody(plain);
  assert.equal(body.isHtml, false);
  assert.equal(body.html, "<p>First para.</p><p>Second para.</p>");
});

test("a bare payload with data but no mimeType is still read", () => {
  // Last-resort branch carried over from the MOO-494 implementation. No probed
  // message has ever arrived this way, so it stays tested rather than trusted.
  const bare = { payload: { body: { data: b64("Bare body\n\nSecond") } } };
  assert.deepEqual(messageBody(bare), {
    html: "<p>Bare body</p><p>Second</p>",
    isHtml: false,
  });
});

test("a message with no body at all yields nothing, not an empty paragraph", () => {
  assert.deepEqual(messageBody({}), { html: "", isHtml: false });
});

// ---- textToHtml ----

test("a blank line starts a new paragraph", () => {
  assert.equal(textToHtml("one\n\ntwo"), "<p>one</p><p>two</p>");
});

test("a single newline is a line break inside the paragraph", () => {
  assert.equal(textToHtml("one\ntwo"), "<p>one<br>two</p>");
});

test("angle brackets are escaped so source can never render as markup", () => {
  assert.equal(textToHtml("a <b>bold</b> & co"), "<p>a &lt;b&gt;bold&lt;/b&gt; &amp; co</p>");
});

test("CRLF is normalised before splitting", () => {
  assert.equal(textToHtml("one\r\n\r\ntwo"), "<p>one</p><p>two</p>");
});

test("empty text yields empty output", () => {
  assert.equal(textToHtml("   "), "");
});

// ---- previewSnippet ----

test("the list row uses Gmail's own preview, not the raw source", () => {
  const snippet = previewSnippet(meshMessage);
  assert.ok(!snippet.includes("<"), `still shows markup: ${snippet}`);
  assert.match(snippet, /WEEKLY DIGEST/);
});

test("numeric entities are decoded", () => {
  assert.equal(previewSnippet({ preview: { body: "It&#39;s here" } }), "It's here");
});

test("named entities are decoded", () => {
  assert.equal(
    previewSnippet({ preview: { body: "Tom &amp; Jerry &lt;3" } }),
    "Tom & Jerry <3",
  );
});

test("zero-width preheader padding is stripped", () => {
  // Real value from the Uncommon Goods row: the preheader is padded with
  // U+200C and U+034F so the inbox preview stops early.
  const padded = "Open to see our uncommon-est things ‌ ͏ ‌";
  assert.equal(previewSnippet({ preview: { body: padded } }), "Open to see our uncommon-est things");
});

test("falls back to the body text when no preview is offered", () => {
  const snippet = previewSnippet({
    payload: { mimeType: "text/plain", body: { data: b64("Fallback body text") } },
  });
  assert.match(snippet, /Fallback body text/);
});

test("the fallback never leaks markup either", () => {
  const snippet = previewSnippet({ messageText: MESH_HTML });
  assert.ok(!snippet.includes("<"), `leaked markup: ${snippet}`);
});
