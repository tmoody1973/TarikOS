"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useConversation } from "@elevenlabs/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/* Full talk screen (MOO-527). The session lives in ConversationProvider above
 * the router (AppShell), so arriving here does not start one and leaving does
 * not end it — this is a view onto a session that already exists.
 *
 * useConversation() with no arguments reads the live session from context and
 * registers no callbacks of its own, so VoiceDock keeps ownership of
 * onMessage and the transcript writes. The turns come back from Convex rather
 * than from component state: realtime either way, but the database version
 * survives a refresh and needs no state lifted out of the dock.
 *
 * The spine stays on screen. Talk is a page, not a mode you are trapped in. */

const Orb = dynamic(() => import("@/components/hud/Orb").then((m) => m.Orb), {
  ssr: false,
});

const ORB_COLORS: [string, string] = ["#ff9900", "#35e0ff"];

function scaleVolume(get: (() => number) | undefined): number {
  try {
    return Math.min(1, Math.pow(get?.() ?? 0, 0.5) * 2.5);
  } catch {
    return 0;
  }
}

export default function TalkPage() {
  const {
    status,
    isSpeaking,
    isMuted,
    setMuted,
    endSession,
    getInputVolume,
    getOutputVolume,
  } = useConversation();
  const connected = status === "connected";

  const transcript = useQuery(api.transcripts.latest, {});
  const turns = transcript?.turns ?? [];

  const scaledInput = useCallback(
    () => scaleVolume(getInputVolume),
    [getInputVolume],
  );
  const scaledOutput = useCallback(
    () => scaleVolume(getOutputVolume),
    [getOutputVolume],
  );

  // Follow the conversation as it arrives; a transcript you have to chase is
  // not a transcript you can talk over.
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
              getInputVolume={scaledInput}
              getOutputVolume={scaledOutput}
            />
          ) : (
            <Orb colors={ORB_COLORS} volumeMode="auto" agentState={null} />
          )}
        </div>
        {/* Glow Means Live: the status only glows while a session is up. */}
        <span
          className={`text-[10px] uppercase tracking-[0.3em] ${
            connected
              ? `hud-glow ${isSpeaking ? "text-amber" : "text-cyan-hud"}`
              : "text-steel"
          }`}
        >
          {connected ? (isSpeaking ? "Zola speaking" : "Listening") : "Standby"}
        </span>
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
                <span
                  className={
                    t.role === "tarik" ? "text-hudblue" : "text-amber"
                  }
                >
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
          onClick={() => endSession()}
          disabled={!connected}
          className="lcars-cap-left flex h-10 flex-1 items-center justify-center bg-salmon transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40"
        >
          {/* Antonio speaks only in caps (DESIGN.md § The Two Voices Rule);
              the dock's own button is DISENGAGE. */}
          <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
            Disengage
          </span>
        </button>
      </div>
    </div>
  );
}
