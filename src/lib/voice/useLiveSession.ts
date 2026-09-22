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
import {
  EMPTY_CALL_STATE,
  parseArguments,
  reduceCallEvent,
  type CallState,
  type PendingCall,
} from "./liveCalls.ts";
import { appendDelta, type LiveVoice, type Turn } from "./liveSession.ts";
import { BROWSER_TOOLS } from "./liveToolTypes.ts";
import { resolveNavigation } from "./navigation.ts";

/* One GPT-Live session from the browser: mic and speaker on WebRTC media
 * tracks, JSON events on the "oai-events" data channel, tool calls forwarded
 * to /api/voice/tool-call, transcripts to Convex.
 *
 * Lifted out of the phase 0 page so phase 2 can wrap it in a provider and
 * swap VoiceDock and /talk onto it. Phase 2 adds: input and output volume for
 * the orb, isSpeaking, a separate error, mute, and an event timeline for
 * post-call spans. */

export type LiveStatus = "standby" | "connecting" | "live" | "closing";

export type LiveSession = {
  status: LiveStatus;
  sessionId: string | null;
  note: string;
  seconds: number | null;
  captions: Turn[];
  activeTool: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

const CLOSE_TIMEOUT_MS = 15_000;
const ICE_TIMEOUT_MS = 10_000;
// Let the spoken goodbye finish arriving before the close lands.
const END_CALL_GRACE_MS = 1_500;

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
  const [seconds, setSeconds] = useState<number | null>(null);
  const [captions, setCaptions] = useState<Turn[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const convex = useConvex();
  const startTranscript = useMutation(api.transcripts.start);
  const appendTurn = useMutation(api.transcripts.appendTurn);
  const logToolCall = useMutation(api.transcripts.logToolCall);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const eventsRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptId = useRef<Id<"transcripts"> | null>(null);
  const calls = useRef<CallState>(EMPTY_CALL_STATE);
  // The turn being spoken right now, not yet written to Convex.
  const openTurn = useRef<Turn | null>(null);
  // The data-channel listener lives for the whole session; reading the
  // handler through a ref means a re-created callback can never strand it.
  const onEventRef = useRef<(raw: string) => void>(() => {});

  const send = useCallback((event: Record<string, unknown>) => {
    const ch = eventsRef.current;
    if (ch?.readyState === "open") ch.send(JSON.stringify(event));
  }, []);

  const flushTurn = useCallback(() => {
    const turn = openTurn.current;
    const id = transcriptId.current;
    openTurn.current = null;
    if (turn && id && turn.text.trim()) {
      appendTurn({ transcriptId: id, role: turn.role, text: turn.text.trim() }).catch(() => {});
    }
  }, [appendTurn]);

  const cleanup = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    flushTurn();
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
    calls.current = EMPTY_CALL_STATE;
    setActiveTool(null);
    setStatus("standby");
  }, [flushTurn]);

  useEffect(() => () => cleanup(), [cleanup]);

  const stop = useCallback(() => {
    const ch = eventsRef.current;
    if (!ch || ch.readyState !== "open") return;
    setStatus("closing");
    setNote("Finishing…");
    // session.closed is handled in onEvent. Keep media and events alive until
    // it arrives so final usage is confirmed.
    send({ type: "session.close" });
    closeTimer.current = setTimeout(() => {
      setNote("Incomplete finalization: no session.closed event.");
      cleanup();
    }, CLOSE_TIMEOUT_MS);
  }, [send, cleanup]);

  const runCall = useCallback(
    async (call: PendingCall): Promise<string> => {
      const args = parseArguments(call.arguments);
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
        let output: string;
        try {
          output = await runCall(call);
        } catch (err) {
          output = JSON.stringify({
            ok: false,
            message: err instanceof Error ? err.message : "Tool failed",
          });
        }
        const ok = !/"ok"\s*:\s*false/.test(output);
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
      openTurn.current = { role, text: (openTurn.current?.text ?? "") + delta };
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
          setNote("Connected.");
          break;
        case "session.input_transcript.delta":
          caption("tarik", event.delta);
          break;
        case "session.output_transcript.delta":
          caption("morpheus", event.delta);
          break;
        case "response.event": {
          const result = reduceCallEvent(calls.current, event.event);
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
          cleanup();
          break;
        case "error":
          setNote(`Error: ${event.error.message}`);
          break;
      }
    },
    [caption, runCalls, cleanup],
  );
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setNote("Connecting…");
    setSessionId(null);
    setCaptions([]);
    setSeconds(null);
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
        audio.srcObject = new MediaStream([e.track]);
        audio.play().catch(() => setNote("Browser blocked autoplay. Click the page and retry."));
      });

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      for (const track of mic.getAudioTracks()) peer.addTrack(track, mic);

      const events = peer.createDataChannel("oai-events");
      eventsRef.current = events;
      events.addEventListener("message", (m) => onEventRef.current(m.data));
      events.addEventListener("close", () => {
        // After a graceful close, cleanup has already replaced eventsRef.
        if (eventsRef.current === events) {
          setNote("Disconnected without final session usage.");
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
      setNote(err instanceof Error ? err.message : String(err));
      cleanup();
    }
  }, [convex, startTranscript, voice, cleanup]);

  return { status, sessionId, note, seconds, captions, activeTool, start, stop };
}
