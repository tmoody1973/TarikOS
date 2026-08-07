"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useConversation } from "@elevenlabs/react";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LiveWaveform } from "./LiveWaveform";
import { Matrix } from "./Matrix";

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

const MATRIX_COLS = 24;
const IDLE_LEVELS = Array<number>(MATRIX_COLS).fill(0);

// Word-by-word reveal for Zola's newest transcript line; invisible remainder
// reserves layout so the paragraph doesn't jump while revealing.
function RevealText({ text }: { text: string }) {
  const words = text.split(" ");
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    const timer = setInterval(
      () => setCount((c) => Math.min(c + 1, words.length)),
      40,
    );
    return () => clearInterval(timer);
  }, [text, words.length]);
  return (
    <span className="text-foreground/85">
      {words.slice(0, count).join(" ")}
      <span aria-hidden className="opacity-0">
        {" " + words.slice(count).join(" ")}
      </span>
    </span>
  );
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
      toolActivityRef.current = 1; // light up the SYS matrix
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

  // Tool-activity matrix: tool responses spike a level that decays over ~1s,
  // driving a flickering VU pattern. Dark when nothing is happening.
  const toolActivityRef = useRef(0);
  const [matrixLevels, setMatrixLevels] = useState<number[]>(IDLE_LEVELS);
  useEffect(() => {
    if (!connected) {
      toolActivityRef.current = 0;
      setMatrixLevels(IDLE_LEVELS);
      return;
    }
    const timer = setInterval(() => {
      toolActivityRef.current *= 0.88;
      const a = toolActivityRef.current;
      setMatrixLevels(
        a < 0.02
          ? IDLE_LEVELS
          : Array.from(
              { length: MATRIX_COLS },
              () => a * (0.3 + Math.random() * 0.7),
            ),
      );
    }, 100);
    return () => clearInterval(timer);
  }, [connected]);

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
        <span className="shrink-0 text-xs tracking-[0.25em] text-steel">
          {connected
            ? isSpeaking
              ? "ZOLA SPEAKING"
              : "LISTENING"
            : "VOICE LINK STANDBY"}
        </span>
        {/* Mic confidence: thin scrolling waveform of the live input */}
        <div className="mx-2 h-6 min-w-0 flex-1">
          {connected && (
            <LiveWaveform
              active
              mode="scrolling"
              barColor="#ff9900"
              barWidth={2}
              barGap={2}
              height={24}
              fadeEdges
              className="h-6 w-full"
            />
          )}
        </div>
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

      {/* SYS readout: dot-matrix flickers while Zola's tools are working */}
      <div className="mx-auto mt-2 flex shrink-0 flex-col items-center gap-1">
        <Matrix
          rows={5}
          cols={MATRIX_COLS}
          mode="vu"
          levels={matrixLevels}
          size={4}
          gap={2}
          palette={{ on: "#35e0ff", off: "#131a26" }}
          ariaLabel="Tool activity"
        />
        <span className="text-[9px] tracking-[0.35em] text-steel">
          TOOL ACTIVITY
        </span>
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
              {turn.role === "morpheus" && i === turns.length - 1 ? (
                <RevealText text={turn.text} />
              ) : (
                <span className="text-foreground/85">{turn.text}</span>
              )}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
