import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDraftRows } from "../src/lib/mail.ts";

// GMAIL_LIST_DRAFTS verbose shape, probed live 2026-08-07:
// { drafts: [{ id, message: { subject, to, sender, messageTimestamp, threadId, messageText } }] }

test("maps a verbose draft row to a DraftRow", () => {
  const rows = mapDraftRows(
    [
      {
        id: "r123",
        message: {
          subject: "Hello",
          to: "someone@example.com",
          sender: "Tarik Moody <tarik@radiomilwaukee.org>",
          messageTimestamp: "2026-08-04T14:01:42Z",
          threadId: "19fcd1489b8a8c18",
          messageText: "body text here",
        },
      },
    ],
    "work-gmail",
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    draftId: "r123",
    account: "work-gmail",
    to: "someone@example.com",
    subject: "Hello",
    snippet: "body text here",
    date: "2026-08-04T14:01:42Z",
    threadId: "19fcd1489b8a8c18",
  });
});

test("tolerates missing message and fields", () => {
  const rows = mapDraftRows([{ id: "r9" }, { message: {} }], "work-gmail");
  assert.equal(rows.length, 1); // row without id is dropped
  assert.equal(rows[0].draftId, "r9");
  assert.equal(rows[0].subject, "(no subject)");
  assert.equal(rows[0].to, "");
  assert.equal(rows[0].threadId, undefined);
});

test("snippet is truncated to 140 chars", () => {
  const rows = mapDraftRows(
    [{ id: "r1", message: { messageText: "x".repeat(500) } }],
    "work-gmail",
  );
  assert.equal(rows[0].snippet.length, 140);
});
