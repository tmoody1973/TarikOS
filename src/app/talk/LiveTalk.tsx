"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LIVE_USD_PER_MINUTE } from "@/lib/voice/liveSession";
import { useLive } from "@/components/LiveProvider";

/* The full talk screen on GPT-Live. A view onto the session LiveProvider
 * holds; arriving here does not start one and leaving does not end it.
 *
 * While live, the turns come from the provider's captions, because a Zola
 * turn only reaches Convex when the speaker changes and the screen must not
 * run a whole reply behind. Idle, the last conversation comes from Convex,
 * which survives a refresh. */

const Orb = dynamic(() => import("@/components/hud/Orb").then((m) => m.Orb), {
  ssr: false,
});

const ORB_COLORS: [string, string] = ["#ff9900", "#35e0ff"];

export function LiveTalk() {
  const {
    connected,
    isSpeaking,
    isMuted,
    setMuted,
    stop,
    captions,
    activeTool,
    seconds,
    getInputVolume,
    getOutputVolume,
  } = useLive();

  // transcripts.latest throws without an identity, and on a fresh load the
  // page renders before Convex has Clerk's token. Skip until it does; the
  // same "skip" pattern the habits and briefs pages use. First seen live on
  // 2026-09-22 when /talk-live started redirecting here.
  const { isAuthenticated } = useConvexAuth();
  const last = useQuery(api.transcripts.latest, isAuthenticated ? {} : "skip");
  const turns = connected ? captions : (last?.turns ?? []);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-col items-center gap-2 pt-2">
        <div className="h-40 w-40">
          {connected ? (
            <Orb
              colors={ORB_COLORS}
              volumeMode="manual"
              getInputVolume={getInputVolume}
              getOutputVolume={getOutputVolume}
            />
          ) : (
            <Orb colors={ORB_COLORS} volumeMode="auto" agentState={null} />
          )}
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.3em] ${
            connected
              ? `hud-glow ${isSpeaking ? "text-amber" : "text-cyan-hud"}`
              : "text-steel"
          }`}
        >
          {connected ? (isSpeaking ? "Zola speaking" : "Listening") : "Standby"}
        </span>
        {connected && (
          <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
            {activeTool ? <span className="text-amber">{activeTool} · </span> : null}
            {seconds != null ? `${seconds}s · $${((seconds / 60) * LIVE_USD_PER_MINUTE).toFixed(3)}` : ""}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-panel-edge bg-panel p-3">
        <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
          {connected ? "Transcript" : "Last conversation"}
        </span>
        <div className="mt-2 flex-1 space-y-3 overflow-y-auto">
          {turns.length === 0 ? (
            <p className="text-sm italic text-steel">
              {connected
                ? "Live. Say something."
                : "Nothing yet — engage the voice link and talk to Zola."}
            </p>
          ) : (
            turns.map((t, i) => (
              <p key={i} className="text-sm leading-relaxed">
                <span className={t.role === "tarik" ? "text-hudblue" : "text-amber"}>
                  {t.role === "tarik" ? "TARIK" : "ZOLA"}
                </span>{" "}
                <span className="text-foreground/85">{t.text}</span>
              </p>
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMuted(!isMuted)}
          disabled={!connected}
          aria-pressed={isMuted}
          className="rounded-md border border-panel-edge px-3 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-cyan-hud hover:text-cyan-hud motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40"
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!connected}
          className="lcars-cap-left flex h-10 flex-1 items-center justify-center bg-salmon transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40"
        >
          <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
            Disengage
          </span>
        </button>
      </div>
    </div>
  );
}
