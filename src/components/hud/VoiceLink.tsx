"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useConversation } from "@elevenlabs/react";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Lazy WebGL orb — three.js only downloads when the HUD mounts client-side.
const Orb = dynamic(() => import("./Orb").then((m) => m.Orb), { ssr: false });

type Turn = { role: "tarik" | "morpheus"; text: string };

// LCARS palette: amber core, HUD-cyan halo.
const ORB_COLORS: [string, string] = ["#ff9900", "#35e0ff"];

// Raw SDK volume sits low; the official blocks apply this curve so the orb
// visibly moves. The getters throw when no session is active.
function scaleVolume(get: (() => number) | undefined): number {
  try {
    return Math.min(1, Math.pow(get?.() ?? 0, 0.5) * 2.5);
  } catch {
    return 0;
  }
}

export function VoiceLink() {
  const convexClient = useConvex();
  const startTranscript = useMutation(api.transcripts.start);
  const appendTurn = useMutation(api.transcripts.appendTurn);
  const logToolCall = useMutation(api.transcripts.logToolCall);

  const transcriptIdRef = useRef<Id<"transcripts"> | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const conversation = useConversation({
    onMessage: ({ message, source }) => {
      const role = source === "user" ? "tarik" : "morpheus";
      setTurns((prev) => [...prev, { role, text: message }]);
      const transcriptId = transcriptIdRef.current;
      if (transcriptId) {
        appendTurn({ transcriptId, role, text: message }).catch(() => {});
      }
    },
    onAgentToolResponse: (props: { tool_name?: string; is_error?: boolean }) => {
      const transcriptId = transcriptIdRef.current;
      if (transcriptId && props?.tool_name) {
        logToolCall({
          transcriptId,
          tool: props.tool_name,
          status: props.is_error ? "error" : "ok",
        }).catch(() => {});
      }
    },
    onError: (message: string) => setError(message),
    onDisconnect: () => {
      transcriptIdRef.current = null;
    },
  });

  const { status, isSpeaking, getInputVolume, getOutputVolume } = conversation;
  const connected = status === "connected";

  const scaledInput = useCallback(
    () => scaleVolume(getInputVolume),
    [getInputVolume],
  );
  const scaledOutput = useCallback(
    () => scaleVolume(getOutputVolume),
    [getOutputVolume],
  );

  async function engage() {
    setError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/voice/token");
      if (!res.ok) throw new Error(`Token endpoint: ${res.status}`);
      const { token } = await res.json();

      const standingContext = await convexClient.query(
        api.secondBrain.standingContext,
        {},
      );
      const transcriptId = await startTranscript({
        title: `Conversation ${new Date().toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`,
      });
      transcriptIdRef.current = transcriptId;
      setTurns([]);

      conversation.startSession({
        conversationToken: token,
        connectionType: "webrtc",
        dynamicVariables: { standing_context: standingContext },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to engage");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-panel-edge pb-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            connected
              ? isSpeaking
                ? "bg-amber pulse-soft"
                : "bg-cyan-hud pulse-soft"
              : "bg-steel"
          }`}
        />
        <span className="text-xs tracking-[0.25em] text-steel">
          {connected
            ? isSpeaking
              ? "ZOLA SPEAKING"
              : "LISTENING"
            : "VOICE LINK STANDBY"}
        </span>
        <button
          onClick={connected ? () => conversation.endSession() : engage}
          disabled={connecting}
          className={`lcars-cap-right ml-auto px-4 py-1.5 font-[family-name:var(--font-display)] text-sm text-black transition disabled:opacity-50 ${
            connected ? "bg-salmon hover:opacity-80" : "bg-amber hover:opacity-80"
          }`}
        >
          {connecting ? "LINKING…" : connected ? "DISENGAGE" : "ENGAGE"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-salmon">VOICE LINK ERROR: {error}</p>
      )}

      {/* Zola's orb: idle-breathes via auto mode when disconnected; reacts to
          real session audio (manual mode) when the link is live. */}
      <div className="mx-auto mt-3 h-32 w-32 shrink-0 sm:h-40 sm:w-40">
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

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="mt-2 text-sm italic text-steel">
            {connected
              ? "Live. Say something."
              : "Engage the voice link and talk to Zola."}
          </p>
        ) : (
          turns.map((turn, i) => (
            <p key={i} className="text-sm leading-relaxed">
              <span
                className={
                  turn.role === "tarik" ? "text-hudblue" : "text-amber"
                }
              >
                {turn.role === "tarik" ? "TARIK" : "ZOLA"}
              </span>{" "}
              <span className="text-foreground/85">{turn.text}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}
