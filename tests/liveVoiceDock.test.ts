import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Phase 2 of the GPT-Live migration. LiveVoiceDock is VoiceDock's sibling on
 * the new session, and inherits its rules (DESIGN.md: quiet by default, glow
 * means live). Same source-text guards, plus the switch that picks a dock. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const dock = read("../src/components/LiveVoiceDock.tsx");
const shell = read("../src/components/AppShell.tsx");
const talk = read("../src/app/talk/page.tsx");
const provider = read("../src/lib/voice/provider.ts");

test("the switch defaults to ElevenLabs and only 'openai' flips it", () => {
  assert.match(provider, /NEXT_PUBLIC_VOICE_PROVIDER === "openai" \? "openai" : "elevenlabs"/);
});

test("the shell keeps the ElevenLabs branch verbatim and adds the live one", () => {
  const eleven = shell.indexOf("<ConversationProvider>");
  const live = shell.indexOf("<LiveProvider>");
  assert.ok(eleven > -1 && live > -1, "both providers are mounted somewhere");
  assert.ok(eleven < live, "the ElevenLabs branch stays first, so its guard test keeps reading it");
  const liveShell = shell.slice(live, shell.indexOf("</LiveProvider>"));
  assert.match(liveShell, /<LiveVoiceDock \/>/);
  assert.match(liveShell, /<Authenticated>/);
  assert.match(shell, /voiceProvider\(\) === "openai"/);
});

test("/talk picks the live view by the same switch and keeps the ElevenLabs page", () => {
  assert.match(talk, /voiceProvider\(\) === "openai"\) return <LiveTalk \/>/);
  assert.match(talk, /useConversation\(\)/, "the ElevenLabs page is still there");
});

test("the idle form is a mobile-only cap; desktop keeps the full bar", () => {
  assert.match(dock, /lcars-cap-left/);
  assert.match(dock.slice(dock.indexOf("lcars-cap-left"), dock.indexOf("lcars-cap-left") + 400), /lg:hidden/);
  assert.match(dock, /connected \? "flex" : "hidden lg:flex"/);
  assert.ok(!/if \(!connected\) \{\s*return/.test(dock));
});

test("glow is never applied to something that is not live", () => {
  const occurrences = [...dock.matchAll(/hud-glow/g)];
  assert.ok(occurrences.length > 0);
  for (const m of occurrences) {
    const before = dock.slice(Math.max(0, m.index - 160), m.index);
    assert.match(before, /connected\s*(\?|&&)/);
  }
});

test("every transition pairs with motion-reduce", () => {
  for (const line of dock.split("\n")) {
    if (!/\btransition\b/.test(line)) continue;
    assert.match(line, /motion-reduce:transition-none/, line.trim());
  }
});

test("one way in: the cap, the button and the wake word all call the hook's start", () => {
  assert.match(dock, /useWakeWord\(\(\) => void start\(\), connected\)/);
  assert.ok(!/fetch\("\/api\/voice\/session"/.test(dock), "the dock never opens a session itself");
  assert.ok(!/useLiveSession\(/.test(dock), "the dock reads the shared session, it does not own one");
});

test("the live dock links to /talk and is labelled for assistive tech", () => {
  assert.match(dock, /href="\/talk"/);
  assert.match(dock, /aria-label="Start a voice session"/);
});
