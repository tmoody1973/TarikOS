import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchThread, extractMessageHtml } from "../src/lib/mail.ts";

const rows = [
  { threadId: "t1", account: "work-gmail", from: "WBEZ Newsletters", subject: "This week on Reset", snippet: "", date: "3" },
  { threadId: "t2", account: "work-gmail", from: "Sarah Jones", subject: "Studio schedule question", snippet: "", date: "2" },
  { threadId: "t3", account: "work-gmail", from: "Sarah Miller", subject: "Sponsorship follow-up", snippet: "", date: "1" },
];

// ---- matchThread: prefer none/ambiguous over a wrong match ----

test("single clear match resolves to that thread", () => {
  const r = matchThread(rows, "the WBEZ email");
  assert.equal(r.outcome, "matched");
  assert.equal(r.outcome === "matched" && r.thread.threadId, "t1");
});

test("query matching several senders is ambiguous with candidates", () => {
  const r = matchThread(rows, "sarah's email");
  assert.equal(r.outcome, "ambiguous");
  assert.equal(r.outcome === "ambiguous" && r.candidates.length, 2);
});

test("query matching nothing returns none", () => {
  assert.equal(matchThread(rows, "the invoice from Acme").outcome, "none");
});

test("stopword-only query returns none, never a guess", () => {
  assert.equal(matchThread(rows, "the email").outcome, "none");
});

test("all meaningful tokens must match — partial overlap is none", () => {
  // "sarah sponsorship" tokens both present only on t3
  const r = matchThread(rows, "sarah sponsorship");
  assert.equal(r.outcome, "matched");
  assert.equal(r.outcome === "matched" && r.thread.threadId, "t3");
  // but a token that appears nowhere kills the match
  assert.equal(matchThread(rows, "sarah invoice").outcome, "none");
});

// ---- extractMessageHtml: probed shapes from GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID ----

test("messageText containing HTML is returned as-is", () => {
  const html = extractMessageHtml({ messageText: "<p><strong>hi</strong></p>\n" });
  assert.equal(html, "<p><strong>hi</strong></p>\n");
});

test("base64url text/html payload body is decoded when messageText is plain", () => {
  const data = Buffer.from("<p>from b64</p>").toString("base64url");
  const html = extractMessageHtml({
    messageText: "from b64",
    payload: { mimeType: "text/html", body: { data } },
  });
  assert.equal(html, "<p>from b64</p>");
});

test("multipart message uses its text/html part", () => {
  const data = Buffer.from("<p>part html</p>").toString("base64url");
  const html = extractMessageHtml({
    payload: {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64url") } },
        { mimeType: "text/html", body: { data } },
      ],
    },
  });
  assert.equal(html, "<p>part html</p>");
});

test("plain text falls back to escaped paragraph HTML", () => {
  const html = extractMessageHtml({ messageText: "a < b & c" });
  assert.equal(html, "<p>a &lt; b &amp; c</p>");
});

test("top-level messageHtml field is honored (pickBody shapes)", () => {
  const html = extractMessageHtml({ messageHtml: "<p>top-level</p>" });
  assert.equal(html, "<p>top-level</p>");
});

// The structural guardrail (MOO-494): Zola drafts, only Tarik sends. The
// agent's tool route must never grow a send path.
test("tool route has no send capability", () => {
  const src = readFileSync(
    new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/sendDraft|SEND_DRAFT|GMAIL_SEND/.test(src));
});
