"use client";

import { useEffect, useRef, useState } from "react";
import { redirect } from "next/navigation";
import {
  DEFAULT_VOICE,
  LIVE_USD_PER_MINUTE,
  LIVE_VOICES,
  type LiveVoice,
} from "@/lib/voice/liveSession";
import { voiceProvider } from "@/lib/voice/provider";
import { useLiveSession } from "@/lib/voice/useLiveSession";

/* The ear-test bench from phases 0 and 1: its own GPT-Live session, a voice
 * picker, captions, cost. Once the shell owns the session (openai provider),
 * /talk is the view onto it and this page steps aside. Deleted in phase 4. */

export default function TalkLivePage() {
  if (voiceProvider() === "openai") redirect("/talk");
  return <TalkLiveBench />;
}

function TalkLiveBench() {
  const [voice, setVoice] = useState<LiveVoice>(DEFAULT_VOICE);
  const { status, sessionId, note, error, seconds, captions, activeTool, start, stop } =
    useLiveSession({ voice });
  const live = status === "live";

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions.length]);

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
          GPT-Live
        </span>
        <label className="flex items-center gap-2 text-xs text-steel">
          Voice
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value as LiveVoice)}
            disabled={status !== "standby"}
            className="rounded-md border border-panel-edge bg-panel px-2 py-1 text-xs text-foreground"
          >
            {LIVE_VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`text-[10px] uppercase tracking-[0.3em] ${
            live ? "hud-glow text-cyan-hud" : "text-steel"
          }`}
        >
          {status}
        </span>
        {activeTool && (
          <span className="text-[10px] uppercase tracking-[0.3em] text-amber">
            {activeTool}
          </span>
        )}
        {seconds != null && (
          <span className="text-xs text-steel">
            {seconds}s · ${((seconds / 60) * LIVE_USD_PER_MINUTE).toFixed(3)}
          </span>
        )}
      </div>

      {error ? (
        <p className="text-xs text-salmon">VOICE LINK ERROR: {error}</p>
      ) : (
        note && (
          <p className="text-xs text-steel">
            {note}
            {sessionId && live ? ` Session ${sessionId}` : ""}
          </p>
        )
      )}

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-panel-edge bg-panel p-3">
        <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
          Captions
        </span>
        <div className="mt-2 flex-1 space-y-3 overflow-y-auto">
          {captions.length === 0 ? (
            <p className="text-sm italic text-steel">
              {live ? "Live. Say something." : "Pick a voice, then start."}
            </p>
          ) : (
            captions.map((c, i) => (
              <p key={i} className="text-sm leading-relaxed">
                <span className={c.role === "tarik" ? "text-hudblue" : "text-amber"}>
                  {c.role === "tarik" ? "TARIK" : "ZOLA"}
                </span>{" "}
                <span className="text-foreground/85">{c.text}</span>
              </p>
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={status !== "standby"}
          className="lcars-cap-left flex h-10 flex-1 items-center justify-center bg-cyan-hud transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40"
        >
          <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
            Start
          </span>
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!live}
          className="lcars-cap-left flex h-10 flex-1 items-center justify-center bg-salmon transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40"
        >
          <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
            End
          </span>
        </button>
      </div>
    </div>
  );
}
