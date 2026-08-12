import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The wake word holds an open microphone on Tarik's machine. These are the
// rules that keep that from being a bad idea.

const strip = (s: string) =>
  s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const HOOK = strip(readFileSync("src/components/useWakeWord.ts", "utf8"));
const KEY_ROUTE = strip(readFileSync("src/app/api/wake/key/route.ts", "utf8"));
const DOCK = strip(readFileSync("src/components/VoiceDock.tsx", "utf8"));

test("the access key never reaches the JS bundle", () => {
  // NEXT_PUBLIC_ would inline it into the bundle of a public landing page,
  // where anyone could read it and spend his quota.
  const src = [HOOK, KEY_ROUTE, DOCK].join("\n");
  assert.doesNotMatch(src, /NEXT_PUBLIC_PICOVOICE/);
  assert.match(KEY_ROUTE, /process\.env\.PICOVOICE_ACCESS_KEY/);
});

test("the key endpoint refuses anyone who is not signed in", () => {
  assert.match(KEY_ROUTE, /isAuthenticated/);
  assert.match(KEY_ROUTE, /401/);
});

test("an unset key is an absent feature, not a broken one", () => {
  // 404 rather than a 500 or an empty string: the dock reads it and never
  // offers to arm, instead of offering something that throws on click.
  assert.match(KEY_ROUTE, /404/);
  assert.match(HOOK, /404/);
  assert.match(HOOK, /"unsupported"/);
});

test("the microphone is released while a session is live", () => {
  // THE rule. ElevenLabs' own guide stops its mic stream before starting a
  // session "to avoid conflicts", and a detector left running would hear Zola
  // through the speakers and trigger on her.
  assert.match(HOOK, /suspended/, "the hook must take a suspended flag");
  const effect = HOOK.split("if (suspended)")[1]?.split("}")[0] ?? "";
  assert.match(effect, /release/, "a live session must release the worker");
});

test("the dock suspends the detector on exactly the connected state", () => {
  assert.match(
    DOCK,
    /useWakeWord\([\s\S]{0,80}connected\)/,
    "the dock must pass `connected` as the suspend flag",
  );
});

test("disarming mid-load does not leave a hot microphone behind", () => {
  // The model is ~1MB and takes a moment. Clicking off during that must not
  // hand the worker a microphone nobody is watching.
  assert.match(HOOK, /wantsArmRef\.current/);
  const guard = HOOK.split("if (!wantsArmRef.current) {")[1]?.split("}")[0] ?? "";
  assert.match(guard, /release/);
});

test("the wake word answers before the session can", () => {
  // A chime on detection, because token mint plus WebRTC connect is one to two
  // seconds and silence reads as "it didn't hear me".
  assert.match(HOOK, /earcon\(\)/);
});

test("the model is served from the app, not from a CDN", () => {
  // A wake word that phones a third party on every arm is not the private
  // on-device thing it was chosen for.
  assert.match(HOOK, /"\/wake\/porcupine_params\.pv"/);
  assert.doesNotMatch(HOOK, /https?:\/\/[^"']*\.pv/);
});
