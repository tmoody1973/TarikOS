import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { escapeHtml } from "../src/lib/telegram.ts";

// Zola can now message Tarik unprompted — from a voice command, from a stalled
// browse session, and later from a scheduled brief. The guardrail is the same
// one call_tarik has, and it is structural rather than written down in a
// prompt: there is no destination parameter anywhere, so the chat comes from
// TELEGRAM_OWNER_CHAT_ID on the server and nothing in a request body can
// redirect a message to someone else.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const lib = read("../src/lib/telegram.ts");
const toolRoute = read("../src/app/api/tools/[tool]/route.ts");
const provision = read("../scripts/provision-agent.ts");
const browse = read("../src/app/api/browser/run/route.ts");

/** The send_telegram case, from its label to the next one. */
function sendCase(): string {
  const start = toolRoute.indexOf('case "send_telegram"');
  assert.ok(start > -1, "send_telegram must exist in the tool route");
  const next = toolRoute.indexOf("\n    case ", start + 1);
  const body = toolRoute.slice(
    start,
    next > -1 ? next : toolRoute.indexOf("\n    default:", start),
  );
  assert.ok(body.length > 80, "send_telegram sliced empty — fix the slice");
  return body;
}

test("notifyOwner takes no destination", () => {
  // The signature is the guarantee. A chatId parameter here would be a way to
  // aim a message, and every caller would inherit it.
  assert.match(lib, /export async function notifyOwner\(text: string\)/);
  assert.match(lib, /process\.env\.TELEGRAM_OWNER_CHAT_ID/);
});

test("send_telegram never reads a recipient from the body", () => {
  const fn = sendCase();
  const recipientish =
    /body\.(?:\w*(?:chat|to|recipient|destination|target|user|number|phone)\w*)/i;
  assert.ok(
    !recipientish.test(fn),
    "the destination must not come from the request body",
  );
  assert.match(fn, /notifyOwner\(/, "it must go through the one door");
});

test("the published send_telegram schema exposes no recipient field", () => {
  const start = provision.indexOf('name: "send_telegram"');
  assert.ok(start > -1, "send_telegram must be registered in TOOLS");
  const next = provision.indexOf('name: "', start + 1);
  const entry = provision.slice(start, next > -1 ? next : provision.length);
  const properties = entry.slice(entry.indexOf("properties:"));
  assert.ok(
    !/(chat|recipient|to|destination|phone)\w*:\s*bodyProp/i.test(properties),
    "a published recipient field is a way to redirect a message",
  );
  assert.match(properties, /text: bodyProp\(/);
});

test("a stalled browse session pings rather than phones", () => {
  // A ringing phone is the wrong weight for "the site wants a login".
  const takeover = browse.slice(browse.indexOf('status: "needs_takeover"'));
  assert.match(takeover, /notifyOwner\(/);
});

test("a failed notification cannot fail the thing that sent it", () => {
  // The browse session is waiting for him; a Telegram outage must not turn
  // that into a crashed run.
  assert.match(lib, /export async function notifyOwner[\s\S]*?try \{/);
  assert.match(lib, /return false;/);
  assert.match(browse, /void notifyOwner\(/, "fire and forget");
});

test("text the app did not author is escaped before it is interpolated", () => {
  // A bare `<` rejects the whole message. The fallback would catch it, but at
  // the cost of the formatting of everything around it.
  assert.equal(escapeHtml("5 < 7 & 8 > 2"), "5 &lt; 7 &amp; 8 &gt; 2");
  assert.equal(escapeHtml("<b>not markup</b>"), "&lt;b&gt;not markup&lt;/b&gt;");
  // Ampersand first, or the escapes themselves get escaped.
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("both proactive senders escape what they interpolate", () => {
  assert.match(sendCase(), /escapeHtml\(/);
  assert.match(browse.slice(browse.indexOf("Browse session needs you")), /escapeHtml\(/);
});
