import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The bot username is discoverable and anyone can open a chat with it, so two
// checks carry the whole boundary — and unlike the Telnyx route there is no
// signature to fall back on, only a shared secret in a plain header.
//
//   The secret  — proves Telegram sent it.
//   The chat id — proves Tarik sent it.

const route = readFileSync(
  new URL("../src/app/api/telegram/inbound/route.ts", import.meta.url),
  "utf8",
);
const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
// The send path lives in the shared lib now: the tool route, the takeover
// ping and the brief digest all use it, so its guards protect all of them.
const lib = readFileSync(
  new URL("../src/lib/telegram.ts", import.meta.url),
  "utf8",
);
const libCode = lib.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Comments removed — prose explaining a guard has satisfied assertions about
 * that guard twice today. */
const code = route.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const handler = code.slice(code.indexOf("export async function POST"));

test("/api/telegram is exempt from Clerk, deliberately", () => {
  assert.match(proxy, /"\/api\/telegram\(\.\*\)"/);
});

test("the secret is checked before the body is even read", () => {
  const secret = handler.indexOf("secretMatches");
  const parse = handler.indexOf("req.json()");
  assert.ok(secret > -1, "the route must check the shared secret");
  assert.ok(parse > -1, "the route must read the update");
  assert.ok(
    secret < parse,
    "an unauthenticated caller must not get as far as being parsed",
  );
  // Ordering of *mentions* was the first version of this, and
  // `if (false && !secretMatches(...))` sailed past it — the call was still
  // there, just disabled. Pin the guard's shape: the negation leads.
  assert.match(
    handler,
    /if\s*\(\s*\n?\s*!secretMatches\(/,
    "the secret check must be the condition, not a term inside one",
  );
});

test("a bad secret is refused, not answered", () => {
  const branch = handler.slice(
    handler.indexOf("secretMatches"),
    handler.indexOf("req.json()"),
  );
  assert.match(branch, /status:\s*403/);
  assert.ok(
    !/sendToChat\(/.test(branch),
    "no outbound call on the rejection path",
  );
});

test("a stranger's chat gets no reply", () => {
  const gate = handler.indexOf("if (!isAllowedChat");
  assert.ok(gate > -1, "the allowlist must guard, not merely be consulted");
  const branch = handler.slice(gate, handler.indexOf("}", handler.indexOf("status: 200", gate)));
  assert.match(branch, /status:\s*200/, "200 so Telegram stops redelivering");
  assert.ok(
    !/sendToChat\(/.test(branch),
    "a reply of any kind confirms the bot is live and answering",
  );
});

test("the chat id comes from the update, never from the reply target", () => {
  // Answering `chat.id` from the same update is what keeps this a private
  // line. A configured destination would be a second, unchecked way out.
  assert.match(handler, /update\.message\?\.chat\?\.id/);
});

test("an error tells him something broke without telling him what", () => {
  const catchBlock = handler.slice(handler.indexOf("catch"));
  assert.match(catchBlock, /sendToChat\(/, "silence is worse than an apology");
  assert.ok(
    !/error\.message[^)]*\)\s*,?\s*\)?\s*;?\s*$/m.test(
      catchBlock.slice(0, catchBlock.indexOf("return")),
    ) || !/sendMessage\([^)]*error/.test(catchBlock),
    "the error text can carry keys and internal paths — it stays in the log",
  );
});

test("the reply is truncated to something a phone can show", () => {
  assert.match(libCode, /MAX_REPLY\s*=\s*\d+/);
  assert.match(libCode, /slice\(0, MAX_REPLY\)/);
});

// ── Formatting ────────────────────────────────────────────────────────────
//
// Verified against the live API, not the docs: Telegram accepts b, i, code,
// pre, s, u, a and blockquote; it rejects <h1>; a bare `&` is fine; and a
// bare `<` — "5 < 7" in ordinary prose — rejects the ENTIRE message with
// "can't parse entities". Without a fallback, that failure mode is a question
// answered by silence.

test("the reply is sent as HTML", () => {
  assert.match(libCode, /parse_mode:\s*"HTML"/);
});

test("a parse failure falls back to plain text rather than vanishing", () => {
  assert.match(libCode, /can't parse entities/, "the retry keys off Telegram's own message");
  assert.match(libCode, /stripTags\(/, "and strips what it could not parse");
  // The fallback must not itself ask for HTML, or it fails the same way twice.
  const fallback = libCode.slice(libCode.indexOf("can't parse entities"));
  // `[^)]*` was the first attempt and could never match: the argument is
  // `stripTags(text)`, which contains the paren the class excludes.
  assert.match(
    fallback,
    /post\(token, chatId, stripTags\(text\), false\)/,
    "the retry sends without parse_mode, or it fails the same way twice",
  );
});

test("a failure that is not a parse error still throws", () => {
  // A 401 or a 429 must not be silently downgraded into a plain-text resend
  // that fails the same way — those need to reach the log as errors.
  assert.match(libCode, /if \(!detail\.includes\("can't parse entities"\)\) \{[\s\S]{0,80}throw/);
});

test("the model is told which tags exist and how to escape", () => {
  assert.match(libCode, /TELEGRAM_TAGS/);
  assert.match(route, /&lt;/, "it must be told to escape a bare less-than");
});

// ── Conversation memory ───────────────────────────────────────────────────

test("history is loaded before the model is asked", () => {
  const load = handler.indexOf("api.telegram.context");
  const ask = handler.indexOf("client.messages.create");
  assert.ok(load > -1, "the route must load the conversation");
  assert.ok(load < ask, "context that arrives after the question is no context");
});

test("turns are stored only after the reply is sent", () => {
  // A question that was never answered must not sit in the history as though
  // it had been — the next message would be answered in a frame that never
  // actually happened.
  const send = handler.indexOf("await sendToChat(String(chatId), spoken)");
  const store = handler.indexOf("api.telegram.appendTurn");
  assert.ok(send > -1 && store > -1);
  assert.ok(send < store, "send first, then record");
});

test("both sides of the exchange are recorded", () => {
  const stores = [...handler.matchAll(/role:\s*"(user|assistant)"/g)].map((m) => m[1]);
  assert.ok(stores.includes("user"), "his message");
  assert.ok(stores.includes("assistant"), "and the answer");
});

test("history is keyed to the chat it came from", () => {
  // A single shared history would be an actual leak the moment a second chat
  // is ever allowed.
  assert.match(handler, /api\.telegram\.context,\s*{\s*\n?\s*secret,\s*\n?\s*chatId:/);
});
