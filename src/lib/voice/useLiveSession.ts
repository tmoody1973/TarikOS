"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useMutation } from "convex/react";
import type {
  LiveCreateResponse,
  ServerEvent,
} from "openai/resources/live/live";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { meterFor, scale, type LevelMeter } from "./audioLevel.ts";
import {
  EMPTY_CALL_STATE,
  parseArguments,
  reduceCallEvent,
  type CallState,
  type PendingCall,
} from "./liveCalls.ts";
import type { LivePostCall, LiveTurn } from "./livePostCall.ts";
import { appendDelta, type LiveVoice, type Turn } from "./liveSession.ts";
import { BROWSER_TOOLS } from "./liveToolTypes.ts";
import { resolveNavigation } from "./navigation.ts";

/* One GPT-Live session from the browser: mic and speaker on WebRTC media
 * tracks, JSON events on the "oai-events" data channel, tool calls forwarded
 * to /api/voice/tool-call, transcripts to Convex, and the whole timeline
 * posted to /api/voice/post-call when the session closes.
 *
 * Held by LiveProvider so the dock, /talk and /talk-live share one session. */

export type LiveStatus = "standby" | "connecting" | "live" | "closing";

export type LiveSession = {
  status: LiveStatus;
  connected: boolean;
  sessionId: string | null;
  note: string;
  error: string | null;
  seconds: number | null;
  captions: Turn[];
  activeTool: string | null;
  // Bumps on every tool result so a VU meter can pulse without polling state.
  lastToolAt: number;
  isSpeaking: boolean;
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  // Scaled 0..1 on the orb's curve.
  getInputVolume: () => number;
  getOutputVolume: () => number;
  start: () => Promise<void>;
  stop: () => void;
};

const CLOSE_TIMEOUT_MS = 15_000;
const ICE_TIMEOUT_MS = 10_000;
// Let the spoken goodbye finish arriving before the close lands.
const END_CALL_GRACE_MS = 1_500;
// GPT-Live has no end-of-speech event; speaking is "output level above this
// within the last SPEAKING_HOLD_MS", sampled at SPEAKING_POLL_MS.
const SPEAKING_LEVEL = 0.04;
const SPEAKING_HOLD_MS = 350;
const SPEAKING_POLL_MS = 100;

const reply = (message: string) => JSON.stringify({ ok: true, message });

async function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onState);
      reject(new Error("Timed out gathering ICE candidates"));
    }, ICE_TIMEOUT_MS);
    function onState() {
      if (peer.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }
    peer.addEventListener("icegatheringstatechange", onState);
  });
}

export function useLiveSession({ voice }: { voice: LiveVoice }): LiveSession {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("standby");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [captions, setCaptions] = useState<Turn[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [lastToolAt, setLastToolAt] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const convex = useConvex();
  const startTranscript = useMutation(api.transcripts.start);
  const appendTurn = useMutation(api.transcripts.appendTurn);
  const logToolCall = useMutation(api.transcripts.logToolCall);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const eventsRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inMeter = useRef<LevelMeter | null>(null);
  const outMeter = useRef<LevelMeter | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptId = useRef<Id<"transcripts"> | null>(null);
  const calls = useRef<CallState>(EMPTY_CALL_STATE);
  // The turn being spoken right now, not yet written to Convex.
  const openTurn = useRef<Omit<LiveTurn, "endMs"> | null>(null);
  // Everything the post-call trace needs, in session-relative ms.
  const startedAt = useRef(0);
  const timeline = useRef<Pick<LivePostCall, "turns" | "tools">>({ turns: [], tools: [] });
  const sessionIdRef = useRef<string | null>(null);
  // The data-channel listener lives for the whole session; reading the
  // handler through a ref means a re-created callback can never strand it.
  const onEventRef = useRef<(raw: string) => void>(() => {});

  const now = () => Date.now() - startedAt.current;

  const send = useCallback((event: Record<string, unknown>) => {
    const ch = eventsRef.current;
    if (ch?.readyState === "open") ch.send(JSON.stringify(event));
  }, []);

  const flushTurn = useCallback(() => {
    const turn = openTurn.current;
    const id = transcriptId.current;
    openTurn.current = null;
    const text = turn?.text.trim();
    if (!turn || !text) return;
    timeline.current.turns.push({ role: turn.role, text, startMs: turn.startMs, endMs: now() });
    if (id) appendTurn({ transcriptId: id, role: turn.role, text }).catch(() => {});
  }, [appendTurn]);

  const postCall = useCallback(
    (finalSeconds: number, reason: string) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const payload: LivePostCall = {
        sessionId: id,
        startedAt: startedAt.current,
        seconds: finalSeconds,
        reason,
        voice,
        transport: "webrtc",
        turns: timeline.current.turns,
        tools: timeline.current.tools,
      };
      fetch("/api/voice/post-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    },
    [voice],
  );

  const cleanup = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    flushTurn();
    inMeter.current?.close();
    outMeter.current?.close();
    inMeter.current = null;
    outMeter.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    eventsRef.current?.close();
    peerRef.current?.close();
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
    }
    micRef.current = null;
    eventsRef.current = null;
    peerRef.current = null;
    audioRef.current = null;
    transcriptId.current = null;
    sessionIdRef.current = null;
    calls.current = EMPTY_CALL_STATE;
    setActiveTool(null);
    setIsSpeaking(false);
    setIsMuted(false);
    setStatus("standby");
  }, [flushTurn]);

  useEffect(() => () => cleanup(), [cleanup]);

  // Speaking indicator from the output level. Only runs while live.
  useEffect(() => {
    if (status !== "live") return;
    let lastLoud = 0;
    const timer = setInterval(() => {
      const level = outMeter.current?.level() ?? 0;
      const t = Date.now();
      if (level > SPEAKING_LEVEL) lastLoud = t;
      setIsSpeaking(t - lastLoud < SPEAKING_HOLD_MS);
    }, SPEAKING_POLL_MS);
    return () => clearInterval(timer);
  }, [status]);

  const stop = useCallback(() => {
    const ch = eventsRef.current;
    if (!ch || ch.readyState !== "open") return;
    setStatus("closing");
    setNote("Finishing…");
    // session.closed is handled in onEvent. Keep media and events alive until
    // it arrives so final usage is confirmed.
    send({ type: "session.close" });
    closeTimer.current = setTimeout(() => {
      setError("Session did not confirm its close.");
      cleanup();
    }, CLOSE_TIMEOUT_MS);
  }, [send, cleanup]);

  const setMuted = useCallback(
    (muted: boolean) => {
      micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
      send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute" });
      setIsMuted(muted);
    },
    [send],
  );

  const runCall = useCallback(
    async (call: PendingCall, args: Record<string, unknown>): Promise<string> => {
      if (call.name === "navigate_ui") {
        const nav = resolveNavigation(args);
        if (nav.path) router.push(nav.path);
        return reply(nav.message);
      }
      if (call.name === "end_call") {
        setTimeout(stop, END_CALL_GRACE_MS);
        return reply("Ending the session.");
      }
      const res = await fetch("/api/voice/tool-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: call.name, arguments: args }),
      });
      return await res.text();
    },
    [router, stop],
  );

  const runCalls = useCallback(
    async (pending: PendingCall[]) => {
      for (const call of pending) {
        setActiveTool(call.name);
        const startMs = now();
        const args = parseArguments(call.arguments);
        let output: string;
        try {
          output = await runCall(call, args);
        } catch (err) {
          output = JSON.stringify({
            ok: false,
            message: err instanceof Error ? err.message : "Tool failed",
          });
        }
        const ok = !/"ok"\s*:\s*false/.test(output);
        timeline.current.tools.push({
          name: call.name,
          args,
          ok,
          startMs,
          endMs: now(),
          // Short: the close-time post uses keepalive, which browsers cap at
          // 64 KB of body. Full results are in Phoenix tool spans already.
          result: output.slice(0, 400),
        });
        setLastToolAt(Date.now());
        const id = transcriptId.current;
        if (id && !BROWSER_TOOLS.has(call.name)) {
          logToolCall({ transcriptId: id, tool: call.name, status: ok ? "ok" : "error" }).catch(
            () => {},
          );
        }
        send({
          type: "response.item.create",
          event_id: `result_${call.callId}`,
          item: { type: "function_call_output", call_id: call.callId, output },
        });
      }
      setActiveTool(null);
      send({ type: "response.create", event_id: `continue_${Date.now()}` });
    },
    [runCall, logToolCall, send],
  );

  const caption = useCallback(
    (role: Turn["role"], delta: string) => {
      setCaptions((prev) => appendDelta(prev, role, delta));
      if (openTurn.current && openTurn.current.role !== role) flushTurn();
      openTurn.current = openTurn.current
        ? { ...openTurn.current, text: openTurn.current.text + delta }
        : { role, text: delta, startMs: now() };
    },
    [flushTurn],
  );

  const onEvent = useCallback(
    (raw: string) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      switch (event.type) {
        case "session.started":
          setStatus("live");
          setSessionId(event.session.id);
          sessionIdRef.current = event.session.id;
          setNote("Connected.");
          break;
        case "session.input_transcript.delta":
          caption("tarik", event.delta);
          break;
        case "session.output_transcript.delta":
          caption("morpheus", event.delta);
          break;
        case "response.event": {
          const result = reduceCallEvent(calls.current, event.event, event.delegation_id);
          calls.current = result.state;
          if (result.ready) void runCalls(result.ready);
          break;
        }
        case "session.usage.updated":
          setSeconds(event.usage.seconds);
          break;
        case "session.closed":
          setSeconds(event.usage.seconds);
          setNote(`Ended (${event.reason}).`);
          flushTurn();
          postCall(event.usage.seconds, event.reason);
          cleanup();
          break;
        case "error":
          setError(event.error.message);
          break;
      }
    },
    [caption, runCalls, cleanup, flushTurn, postCall],
  );
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setNote("Connecting…");
    setError(null);
    setSessionId(null);
    setCaptions([]);
    setSeconds(null);
    timeline.current = { turns: [], tools: [] };
    startedAt.current = Date.now();
    try {
      const [standingContext, id] = await Promise.all([
        convex.query(api.secondBrain.standingContext, {}),
        startTranscript({
          title: `Conversation ${new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`,
        }),
      ]);
      transcriptId.current = id;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      peer.addEventListener("track", (e) => {
        const remote = new MediaStream([e.track]);
        audio.srcObject = remote;
        audio.play().catch(() => setError("Browser blocked autoplay. Click the page and retry."));
        outMeter.current?.close();
        outMeter.current = meterFor(remote);
      });

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      inMeter.current = meterFor(mic);
      for (const track of mic.getAudioTracks()) peer.addTrack(track, mic);

      const events = peer.createDataChannel("oai-events");
      eventsRef.current = events;
      events.addEventListener("message", (m) => onEventRef.current(m.data));
      events.addEventListener("close", () => {
        // After a graceful close, cleanup has already replaced eventsRef.
        if (eventsRef.current === events) {
          setError("Disconnected without final session usage.");
          cleanup();
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Missing local SDP offer");

      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp, voice, standingContext }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Session request failed (${res.status})`);
      }
      const result = (await res.json()) as LiveCreateResponse;
      await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      // The HTTP request started the session. Do not send session.start.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      cleanup();
    }
  }, [convex, startTranscript, voice, cleanup]);

  // Already on the orb's curve; consumers pass these straight through.
  const getInputVolume = useCallback(() => scale(inMeter.current?.level() ?? 0), []);
  const getOutputVolume = useCallback(() => scale(outMeter.current?.level() ?? 0), []);

  return {
    status,
    connected: status === "live",
    sessionId,
    note,
    error,
    seconds,
    captions,
    activeTool,
    lastToolAt,
    isSpeaking,
    isMuted,
    setMuted,
    getInputVolume,
    getOutputVolume,
    start,
    stop,
  };
}
