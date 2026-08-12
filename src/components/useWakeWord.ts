"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Saying her name instead of reaching for a button.
//
// Porcupine runs entirely on-device: the audio never leaves the machine, which
// is the whole reason this is not the Web Speech API. That one is free and
// zero-dependency and streams your room to Google, which is the wrong trade for
// the assistant holding Tarik's calendar and mail.
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

export type WakeState = "unsupported" | "off" | "arming" | "armed" | "error";

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
 * @param onWake       fired when the word is heard. Start the session here.
 * @param suspended    true while a session is live — releases the microphone.
 */
export function useWakeWord(onWake: () => void, suspended: boolean) {
  const [state, setState] = useState<WakeState>("off");
  const [keyword, setKeyword] = useState("Jarvis");
  const [error, setError] = useState<string | null>(null);

  // The worker and the subscription, kept out of state so releasing them never
  // races a render.
  const workerRef = useRef<{ release: () => Promise<void> } | null>(null);
  const wantsArmRef = useRef(false);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const release = useCallback(async () => {
    const worker = workerRef.current;
    workerRef.current = null;
    if (!worker) return;
    try {
      const { WebVoiceProcessor } = await import("@picovoice/web-voice-processor");
      await WebVoiceProcessor.unsubscribe(worker as never);
      await worker.release();
    } catch {
      // Already gone. Releasing twice must not throw at him.
    }
  }, []);

  const start = useCallback(async () => {
    if (workerRef.current) return;
    setState("arming");
    setError(null);
    try {
      const res = await fetch("/api/wake/key");
      if (res.status === 404) {
        setState("unsupported");
        return;
      }
      if (!res.ok) throw new Error(`key endpoint: ${res.status}`);
      const { key, keyword: word } = await res.json();
      setKeyword(word);

      const [{ PorcupineWorker }, { WebVoiceProcessor }] = await Promise.all([
        import("@picovoice/porcupine-web"),
        import("@picovoice/web-voice-processor"),
      ]);

      // A trained "Hey Zola" is a .ppn in public/wake/; anything else is one of
      // Porcupine's built-ins, which need no training and no Console visit.
      const isCustom = word.endsWith(".ppn");
      const worker = await PorcupineWorker.create(
        key,
        isCustom
          ? { publicPath: `/wake/${word}`, label: word.replace(/\.ppn$/, "") }
          : (word as never),
        () => {
          earcon();
          onWakeRef.current();
        },
        { publicPath: "/wake/porcupine_params.pv" },
      );

      if (!wantsArmRef.current) {
        // Disarmed while the model was loading. Do not leave a hot mic behind.
        await worker.release();
        return;
      }
      workerRef.current = worker as unknown as { release: () => Promise<void> };
      await WebVoiceProcessor.subscribe(worker as never);
      setState("armed");
    } catch (err) {
      workerRef.current = null;
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

  return { state, keyword, error, arm, disarm, armed: state === "armed" };
}
