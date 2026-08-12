import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// The wake word holds an open microphone on Tarik's machine. These are the
// rules that keep that from being a bad idea.

const strip = (s: string) =>
  s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const HOOK = strip(readFileSync("src/components/useWakeWord.ts", "utf8"));
const DOCK = strip(readFileSync("src/components/VoiceDock.tsx", "utf8"));
const PKG = readFileSync("package.json", "utf8");

test("the wake word needs no account and no key", () => {
  // This is why openWakeWord replaced Picovoice, whose Console gates signup
  // behind company approval and charges a monthly slot to train a phrase. A
  // personal assistant must not need someone else's permission to hear its
  // owner.
  assert.match(PKG, /"openwakeword-web"/);
  assert.doesNotMatch(PKG, /@picovoice/);
  assert.doesNotMatch(HOOK, /ACCESS_KEY|accessKey/i);
});

test("nothing is left of the key endpoint", () => {
  assert.equal(
    existsSync("src/app/api/wake/key/route.ts"),
    false,
    "the key route must be deleted, not merely unused",
  );
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
  assert.match(guard, /mic\.stop\(\)/, "the microphone must be stopped, not just forgotten");
});

test("the wake word answers before the session can", () => {
  // A chime on detection, because token mint plus WebRTC connect is one to two
  // seconds and silence reads as "it didn't hear me".
  assert.match(HOOK, /earcon\(\)/);
});

test("the models are served from the app, not from a third party", () => {
  // What he SAYS never leaves the browser, and the three models it is matched
  // against do not come from anyone else's server either.
  assert.match(HOOK, /baseUrl: "\/wake\/models\/"/);
  assert.doesNotMatch(HOOK, /https?:\/\/[^"']*\.onnx/);
  for (const model of [
    "public/wake/models/melspectrogram.onnx",
    "public/wake/models/embedding_model.onnx",
    "public/wake/models/hey_jarvis_v0.1.onnx",
    "public/wake/mic-worklet.js",
  ]) {
    assert.ok(existsSync(model), `${model} must be served from public/`);
  }
});

test("the audio worklet is served from public, not left to the bundler", () => {
  // A worklet the bundler does not emit 404s, and a 404 worklet fails silently:
  // armed, listening to nothing, forever.
  assert.match(HOOK, /workletUrl: "\/wake\/mic-worklet\.js"/);
});

test("frames are dropped rather than queued when inference lags", () => {
  // Inference is async and frames arrive every 80ms. Without a guard a slow
  // machine queues them and detection drifts further behind the longer it runs.
  assert.match(HOOK, /busy/);
});

test("multithreaded wasm is not switched on quietly", () => {
  // It needs SharedArrayBuffer, which needs COOP/COEP on every response — a
  // page-wide change to buy speed on a model that already fits its frame.
  assert.match(HOOK, /numThreads: 1/);
});

test("the threshold is set for a room with a radio in it", () => {
  // openWakeWord defaults to 0.5. Tarik is a radio host — his office has voices
  // and music in it most of the day, and every false fire opens a live mic.
  // 0.7 is the value ElevenLabs' own guide uses, and it is a starting point to
  // tune in the actual room rather than a setting to trust.
  const threshold = Number(HOOK.match(/threshold: ([\d.]+)/)?.[1]);
  assert.ok(threshold >= 0.7, `threshold is ${threshold}; a busy room needs 0.7 or higher`);
});
