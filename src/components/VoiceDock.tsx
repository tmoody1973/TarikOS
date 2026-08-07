"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useConversation } from "@elevenlabs/react";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LiveWaveform } from "./hud/LiveWaveform";
import { Matrix } from "./hud/Matrix";

// Persistent voice console (MOO-483): lives in the root layout so the
// WebRTC session survives page navigation. Compact dock form of the old
// Conversation-zone VoiceLink.

const Orb = dynamic(() => import("./hud/Orb").then((m) => m.Orb), {
  ssr: false,
});

type Turn = { role: "tarik" | "morpheus"; text: string };

const ORB_COLORS: [string, string] = ["#ff9900", "#35e0ff"];
const MATRIX_COLS = 16;
const IDLE_LEVELS = Array<number>(MATRIX_COLS).fill(0);

// Pages Zola can navigate to via the navigate_ui client tool.
const PAGES: Record<string, string> = {
  home: "/",
  briefs: "/briefs",
  brain: "/brain",
  conversations: "/conversations",
  control: "/control",
};

function scaleVolume(get: (() => number) | undefined): number {
  try {
    return Math.min(1, Math.pow(get?.() ?? 0, 0.5) * 2.5);
  } catch {
    return 0;
  }
}

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

export function VoiceDock() {
  const router = useRouter();
  const convexClient = useConvex();
  const startTranscript = useMutation(api.transcripts.start);
  const appendTurn = useMutation(api.transcripts.appendTurn);
  const logToolCall = useMutation(api.transcripts.logToolCall);

  const transcriptIdRef = useRef<Id<"transcripts"> | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const toolActivityRef = useRef(0);
  const [matrixLevels, setMatrixLevels] = useState<number[]>(IDLE_LEVELS);

  const conversation = useConversation({
    clientTools: {
      navigate_ui: async (params: { page?: string; target?: string }) => {
        const path = PAGES[params.page ?? ""];
        if (!path) {
          return `Unknown page "${params.page}". Valid pages: home, briefs, brain, conversations, control.`;
        }
        if (params.page === "briefs" && params.target) {
          router.push(`/briefs?open=${encodeURIComponent(params.target)}`);
          return `Opened the brief matching "${params.target}".`;
        }
        router.push(path);
        return `Navigated to ${params.page}.`;
      },
    },
    onMessage: ({ message, source }) => {
      const role = source === "user" ? "tarik" : "morpheus";
      setTurns((prev) => [...prev.slice(-19), { role, text: message }]);
      const transcriptId = transcriptIdRef.current;
      if (transcriptId) {
        appendTurn({ transcriptId, role, text: message }).catch(() => {});
      }
    },
    onAgentToolResponse: (props: { tool_name?: string; is_error?: boolean }) => {
      toolActivityRef.current = 1;
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

  const lastTurn = turns[turns.length - 1];

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 lg:left-[11.5rem]">
      <div className="flex items-center gap-4 rounded-lg border border-panel-edge bg-panel/95 px-4 py-2.5 backdrop-blur">
        {/* Orb: presence */}
        <div className="h-16 w-16 shrink-0">
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

        {/* Status + mic waveform + tool matrix */}
        <div className="flex w-44 shrink-0 flex-col gap-1.5">
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
            <span className="text-[10px] tracking-[0.25em] text-steel">
              {connected ? (isSpeaking ? "SPEAKING" : "LISTENING") : "STANDBY"}
            </span>
          </div>
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
            levels={matrixLevels}
            size={3}
            gap={2}
            palette={{ on: "#35e0ff", off: "#131a26" }}
            ariaLabel="Tool activity"
          />
        </div>

        {/* Latest exchange */}
        <div className="hidden min-w-0 flex-1 md:block">
          {error ? (
            <p className="text-xs text-salmon">VOICE LINK ERROR: {error}</p>
          ) : lastTurn ? (
            <p className="line-clamp-2 text-sm leading-snug">
              <span
                className={
                  lastTurn.role === "tarik" ? "text-hudblue" : "text-amber"
                }
              >
                {lastTurn.role === "tarik" ? "TARIK" : "ZOLA"}
              </span>{" "}
              {lastTurn.role === "morpheus" ? (
                <RevealText text={lastTurn.text} />
              ) : (
                <span className="text-foreground/85">{lastTurn.text}</span>
              )}
            </p>
          ) : (
            <p className="text-sm italic text-steel">
              {connected
                ? "Live. Say something."
                : "Engage the voice link and talk to Zola."}
            </p>
          )}
        </div>

        <button
          onClick={connected ? () => conversation.endSession() : engage}
          disabled={connecting}
          className={`lcars-cap-right ml-auto shrink-0 px-4 py-1.5 font-[family-name:var(--font-display)] text-sm text-black transition disabled:opacity-50 ${
            connected ? "bg-salmon hover:opacity-80" : "bg-amber hover:opacity-80"
          }`}
        >
          {connecting ? "LINKING…" : connected ? "DISENGAGE" : "ENGAGE"}
        </button>
      </div>
    </div>
  );
}
