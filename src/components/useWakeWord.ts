"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Saying her name instead of reaching for a button.
//
// openWakeWord, Apache-2.0, running entirely on this machine: audio → a
// melspectrogram model → a speech-embedding model → a classifier for the
// phrase, all three ONNX, all three served from /wake/models. Nothing about
// what he says leaves the browser.
//
// It replaced Picovoice, which was the obvious choice and the wrong one for a
// person: their Console gates signup behind company approval and charges a
// monthly slot to train a phrase. This asks for no account at all, and a
// custom "Hey Zola" is a file you drop in public/wake/models — see KEYWORD.
//
// THE RULE THAT SHAPES THIS FILE: the detector must be OFF while a session is
// live. Not as an optimisation — ElevenLabs' own Raspberry Pi guide stops its
// mic stream before start_session "to avoid conflicts", and there is a second
// reason it does not mention: a detector left running hears Zola's own voice
// through the speakers, so she would trigger herself. Which is also why the
// STOP word is not here at all. It is the agent's `end_call` tool, because
// nothing local can listen while she is talking.
//
// The honest ceiling: browsers reject or suspend getUserMedia on backgrounded
// pages by design, so this is "always on while the tab is in front of you",
// never an Echo on the counter. That would be a different device.

export type WakeState = "off" | "arming" | "armed" | "error";

/**
 * The phrase she answers to.
 *
 * "hey_jarvis" is one of openWakeWord's pretrained models and needs nothing
 * from anybody — which is the point, because it means this whole path works
 * before a single word is trained. To use her real name, train one with
 * LiveKit's wake-word trainer, drop `hey_zola.onnx` in public/wake/models, and
 * change this to `{ name: "hey_zola", url: "/wake/models/hey_zola.onnx" }`.
 */
const KEYWORD: string | { name: string; url: string } = {
  name: "hey_zola",
  url: "/wake/models/hey_zola.onnx",
};

/** What the button says. Through a parameter, so TypeScript stops narrowing
 * the constant above to whichever branch it happens to hold today. */
function labelOf(keyword: string | { name: string }): string {
  return (typeof keyword === "string" ? keyword : keyword.name).replace(/_/g, " ");
}

/** What the button says. */
export const KEYWORD_LABEL = labelOf(KEYWORD);

/** Two rising notes: the instant acknowledgement, before the session connects. */
function earcon() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [i, hz] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.09);
    }
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // A missing chime is not a reason to not answer him.
  }
}

/**
 * @param onWake    fired when the phrase is heard. Start the session here.
 * @param suspended true while a session is live — releases the microphone.
 */
export function useWakeWord(onWake: () => void, suspended: boolean) {
  const [state, setState] = useState<WakeState>("off");
  const [error, setError] = useState<string | null>(null);

  // The microphone, kept out of state so releasing it never races a render.
  const micRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const wantsArmRef = useRef(false);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const release = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    try {
      await mic?.stop();
    } catch {
      // Already gone. Releasing twice must not throw at him.
    }
  }, []);

  const start = useCallback(async () => {
    if (micRef.current) return;
    setState("arming");
    setError(null);
    try {
      const [{ OpenWakeWord, configureOrt }, { Microphone }] = await Promise.all([
        import("openwakeword-web"),
        import("openwakeword-web/microphone"),
      ]);

      // One thread on purpose. Multithreaded wasm needs SharedArrayBuffer,
      // which needs COOP/COEP headers on every response — a page-wide change
      // to buy speed on a model that already runs in well under its 80ms frame.
      configureOrt({ numThreads: 1 });

      const oww = await OpenWakeWord.create({
        baseUrl: "/wake/models/",
        wakewordModels: [KEYWORD],
        // 0.07, and the digit is not a typo.
        //
        // A THRESHOLD BELONGS TO A MODEL, NOT TO A CODEBASE. This number came
        // out of hey_zola's own training run, which reported an optimal cut of
        // 0.07 giving recall 0.9995 and 0.168 false positives per hour. The
        // previous model wanted 0.7. Carrying that number across would have
        // produced a detector that armed perfectly and never fired once, which
        // is the hardest kind of broken to notice.
        //
        // Retrain the phrase and this number moves with it. It is a reading,
        // not a preference. docs/lessons/hey_zola.train.yaml is the run.
        threshold: 0.07,
        onDetection: () => {
          earcon();
          onWakeRef.current();
        },
      });

      // Every frame, in order, no exceptions.
      //
      // This is where the first version was wrong and it is worth the words.
      // openWakeWord is a STREAMING pipeline: it carries a raw-audio buffer, a
      // mel buffer and an embedding buffer across calls, and a wake word is
      // assembled from CONSECUTIVE frames. The obvious "robustness" guard —
      // skip a frame if inference is still busy — punches holes in the audio,
      // and a phrase spread across a hole never assembles. It armed perfectly
      // and detected nothing, which is the worst way for a bug to present.
      //
      // So frames are chained rather than dropped. If inference genuinely
      // cannot keep up the backlog is dropped ALL AT ONCE and the buffers are
      // reset, because falling behind cleanly is honest and falling behind
      // silently is what caused this.
      const MAX_BACKLOG = 25; // ~2 seconds of frames
      let backlog = 0;
      let chain: Promise<unknown> = Promise.resolve();
      const mic = new Microphone(
        (frame) => {
          if (backlog > MAX_BACKLOG) return;
          backlog += 1;
          chain = chain
            .then(async () => {
              if (backlog > MAX_BACKLOG) {
                await oww.reset();
                backlog = 0;
                return;
              }
              const scores = await oww.predict(frame);
              // A readout to tune against. "Nothing fires" with no numbers is
              // unfixable; a peak score tells you instantly whether it is the
              // threshold or the pipeline.
              const peak = Math.max(0, ...Object.values(scores));
              if (peak > 0.2) console.debug(`[wake] ${KEYWORD_LABEL} ${peak.toFixed(2)}`);
            })
            .catch(() => {})
            .finally(() => {
              backlog -= 1;
            });
        },
        // Pointed at a copy in public/ because a bundler does not reliably emit
        // an AudioWorklet asset, and a worklet that 404s fails silently.
        { workletUrl: "/wake/mic-worklet.js" },
      );

      if (!wantsArmRef.current) return; // Disarmed while the models loaded.
      await mic.start();
      if (!wantsArmRef.current) {
        // Disarmed during start. Do not leave a hot microphone behind.
        await mic.stop();
        return;
      }
      micRef.current = mic;
      setState("armed");
    } catch (err) {
      micRef.current = null;
      setError(err instanceof Error ? err.message : "Wake word failed to start");
      setState("error");
    }
  }, []);

  /** One click, which is also what unlocks audio playback for the session. */
  const arm = useCallback(() => {
    wantsArmRef.current = true;
    void start();
  }, [start]);

  const disarm = useCallback(() => {
    wantsArmRef.current = false;
    setState("off");
    void release();
  }, [release]);

  // Hand the microphone over for the length of the conversation, and take it
  // back when she hangs up — the listen → detect → converse → listen loop.
  useEffect(() => {
    if (!wantsArmRef.current) return;
    if (suspended) {
      void release();
      return;
    }
    void start();
  }, [suspended, start, release]);

  useEffect(() => () => void release(), [release]);

  return { state, keyword: KEYWORD_LABEL, error, arm, disarm, armed: state === "armed" };
}
