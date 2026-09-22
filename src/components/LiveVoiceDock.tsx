"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { LiveWaveform } from "./hud/LiveWaveform";
import { Matrix } from "./hud/Matrix";
import { useLive } from "./LiveProvider";
import { RevealText } from "./RevealText";
import { useWakeWord } from "./useWakeWord";

/* The persistent voice console on GPT-Live (phase 2 of the migration).
 * Same silhouette and rules as VoiceDock (MOO-483, DESIGN.md: quiet by
 * default, glow means live); the session comes from LiveProvider instead of
 * ElevenLabs. VoiceDock stays until phase 4, so the two are siblings and
 * NEXT_PUBLIC_VOICE_PROVIDER picks one. */

const Orb = dynamic(() => import("./hud/Orb").then((m) => m.Orb), {
  ssr: false,
});

const ORB_COLORS: [string, string] = ["#ff9900", "#35e0ff"];
const MATRIX_COLS = 16;
const IDLE_LEVELS = Array<number>(MATRIX_COLS).fill(0);

export function LiveVoiceDock() {
  const {
    connected,
    status,
    error,
    captions,
    isSpeaking,
    lastToolAt,
    getInputVolume,
    getOutputVolume,
    start,
    stop,
  } = useLive();
  const connecting = status === "connecting";

  // Tool activity pulse for the matrix: kicks on every tool result, decays.
  const toolActivityRef = useRef(0);
  const [matrixLevels, setMatrixLevels] = useState<number[]>(IDLE_LEVELS);
  useEffect(() => {
    if (lastToolAt) toolActivityRef.current = 1;
  }, [lastToolAt]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      toolActivityRef.current *= 0.88;
      const a = toolActivityRef.current;
      setMatrixLevels(
        a < 0.02
          ? IDLE_LEVELS
          : Array.from({ length: MATRIX_COLS }, () => a * (0.3 + Math.random() * 0.7)),
      );
    }, 100);
    return () => clearInterval(timer);
  }, [connected]);

  // One way in: the button, the cap and the wake word all call start.
  // Saying her name instead of reaching for the button. Suspended while a
  // session is live: one microphone, and a detector that could hear her own
  // voice would trigger on it.
  const wake = useWakeWord(() => void start(), connected);

  const lastTurn = captions[captions.length - 1];

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 lg:left-[11.5rem]">
      {!connected && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={connecting}
          aria-label="Start a voice session"
          className="lcars-cap-left ml-auto flex h-7 w-24 items-center justify-center bg-steel transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-50 lg:hidden"
        >
          <span className="font-[family-name:var(--font-display)] text-sm text-black">
            {connecting ? "LINKING…" : "ZOLA"}
          </span>
        </button>
      )}
      <div
        className={`flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-panel-edge bg-panel/95 px-4 py-2.5 backdrop-blur ${
          connected ? "flex" : "hidden lg:flex"
        }`}
      >
        {connected ? (
          <Link
            href="/talk"
            aria-label="Open the full talk screen"
            className="h-16 w-16 shrink-0 rounded-full transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            <Orb
              colors={ORB_COLORS}
              volumeMode="manual"
              getInputVolume={getInputVolume}
              getOutputVolume={getOutputVolume}
            />
          </Link>
        ) : (
          <div className="h-16 w-16 shrink-0">
            <Orb colors={ORB_COLORS} volumeMode="auto" agentState={null} />
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-1.5 md:w-44">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                connected
                  ? isSpeaking
                    ? "bg-amber pulse-soft"
                    : "bg-cyan-hud pulse-soft"
                  : "bg-steel"
              }`}
            />
            <span
              className={`text-[10px] tracking-[0.25em] ${
                connected
                  ? `hud-glow ${isSpeaking ? "text-amber" : "text-cyan-hud"}`
                  : "text-steel"
              }`}
            >
              {connected ? (isSpeaking ? "SPEAKING" : "LISTENING") : "STANDBY"}
            </span>
          </div>
          <div className="hidden md:block">
            <div className="h-5">
              {connected && (
                <LiveWaveform
                  active
                  mode="scrolling"
                  barColor="#ff9900"
                  barWidth={2}
                  barGap={2}
                  height={20}
                  fadeEdges
                  className="h-5 w-full"
                />
              )}
            </div>
            <Matrix
              rows={3}
              cols={MATRIX_COLS}
              mode="vu"
              levels={connected ? matrixLevels : IDLE_LEVELS}
              size={3}
              gap={2}
              palette={{ on: "#35e0ff", off: "#131a26" }}
              ariaLabel="Tool activity"
            />
          </div>
        </div>

        {/* Latest exchange */}
        <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1">
          {error ? (
            <p className="text-xs text-salmon">VOICE LINK ERROR: {error}</p>
          ) : lastTurn ? (
            <p className="line-clamp-2 text-sm leading-snug">
              <span className={lastTurn.role === "tarik" ? "text-hudblue" : "text-amber"}>
                {lastTurn.role === "tarik" ? "TARIK" : "ZOLA"}
              </span>{" "}
              {lastTurn.role === "morpheus" ? (
                <RevealText key={lastTurn.text} text={lastTurn.text} />
              ) : (
                <span className="text-foreground/85">{lastTurn.text}</span>
              )}
            </p>
          ) : (
            <p className="text-sm italic text-steel">
              {connected
                ? "Live. Say something."
                : wake.armed
                  ? `Listening for "${wake.keyword}".`
                  : `Engage, or arm ${wake.keyword.toUpperCase()} and just say it.`}
            </p>
          )}
        </div>

        {!connected && (
          <button
            type="button"
            onClick={wake.armed ? wake.disarm : wake.arm}
            aria-pressed={wake.armed}
            title={
              wake.armed
                ? `Listening for "${wake.keyword}". The tab has to stay in front of you.`
                : "Listen for the wake word"
            }
            className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud ${
              wake.armed
                ? "border-cyan-hud/70 bg-cyan-hud/15 text-foreground"
                : "border-panel-edge text-steel hover:border-cyan-hud/40"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wake.armed ? "bg-cyan-hud pulse-soft" : "bg-steel"
              }`}
            />
            {wake.state === "arming" ? "arming…" : wake.armed ? wake.keyword : "wake"}
          </button>
        )}

        <button
          onClick={connected ? stop : () => void start()}
          disabled={connecting}
          className={`lcars-cap-right shrink-0 px-4 py-1.5 font-[family-name:var(--font-display)] text-sm text-black transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-50 ${
            connected ? "bg-salmon hover:opacity-80" : "bg-amber hover:opacity-80"
          }`}
        >
          {connecting ? "LINKING…" : connected ? "DISENGAGE" : "ENGAGE"}
        </button>
      </div>
    </div>
  );
}
