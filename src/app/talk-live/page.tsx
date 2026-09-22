"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LiveCreateResponse,
  ServerEvent,
} from "openai/resources/live/live";
import {
  ACCENT_MAX_LENGTH,
  appendDelta,
  DEFAULT_VOICE,
  LIVE_USD_PER_MINUTE,
  LIVE_VOICES,
  type LiveVoice,
  type Turn,
} from "@/lib/voice/liveSession";

/* Phase 0 spike: hear GPT-Live, pick a voice. Standalone on purpose. It does
 * not touch VoiceDock, the wake word, or Convex, and it has no tools beyond
 * the backend's web search. If this page is useful, phase 1 grows it into the
 * real client; if not, it is one file to delete.
 *
 * Adapted from OpenAI's GPT-Live WebRTC quickstart. Audio rides the WebRTC
 * media tracks; JSON events ride a data channel named "oai-events". */

type Status = "standby" | "connecting" | "live" | "closing";

const CLOSE_TIMEOUT_MS = 15_000;
const ICE_TIMEOUT_MS = 10_000;

export default function TalkLivePage() {
  const [status, setStatus] = useState<Status>("standby");
  const [voice, setVoice] = useState<LiveVoice>(DEFAULT_VOICE);
  const [accent, setAccent] = useState("South African");
  const [note, setNote] = useState("");
  const [seconds, setSeconds] = useState<number | null>(null);
  const [captions, setCaptions] = useState<Turn[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const eventsRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalized = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll when a caption starts, not on every fragment: fragments arrive
  // many times a second and overlapping smooth scrolls fight each other.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions.length]);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    micRef.current?.getTracks().forEach((t) => t.stop());
    eventsRef.current?.close();
    peerRef.current?.close();
    if (audioRef.current) audioRef.current.srcObject = null;
    micRef.current = null;
    eventsRef.current = null;
    peerRef.current = null;
    setStatus("standby");
  }

  function onEvent(raw: string) {
    let event: ServerEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    switch (event.type) {
      case "session.started":
        setStatus("live");
        setNote(`Connected. Session ${event.session.id}`);
        break;
      case "session.input_transcript.delta":
        setCaptions((prev) => appendDelta(prev, "tarik", event.delta));
        break;
      case "session.output_transcript.delta":
        setCaptions((prev) => appendDelta(prev, "morpheus", event.delta));
        break;
      case "session.usage.updated":
        setSeconds(event.usage.seconds);
        break;
      case "session.closed":
        finalized.current = true;
        setSeconds(event.usage.seconds);
        setNote(`Ended (${event.reason}).`);
        cleanup();
        break;
      case "error":
        setNote(`Error: ${event.error.message}`);
        break;
    }
  }

  async function start() {
    setStatus("connecting");
    setNote("Connecting…");
    setCaptions([]);
    setSeconds(null);
    finalized.current = false;
    try {
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.addEventListener("track", (e) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = new MediaStream([e.track]);
        audioRef.current.play().catch(() => {
          setNote("Press play on the audio control to hear Zola.");
        });
      });

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      for (const track of mic.getAudioTracks()) peer.addTrack(track, mic);

      // Data channel before the offer, per the quickstart.
      const events = peer.createDataChannel("oai-events");
      eventsRef.current = events;
      events.addEventListener("message", (m) => onEvent(m.data));
      events.addEventListener("close", () => {
        if (!finalized.current) {
          setNote("Disconnected without final session usage.");
          cleanup();
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete") {
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
          onState();
        });
      }

      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Missing local SDP offer");
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp, voice, accent }),
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
  }

  function stop() {
    const events = eventsRef.current;
    if (status !== "live" || !events || events.readyState !== "open") return;
    setStatus("closing");
    setNote("Finishing…");
    // session.closed handler is already registered in onEvent. Keep media and
    // events alive until it arrives so final usage is confirmed.
    events.send(JSON.stringify({ type: "session.close" }));
    closeTimer.current = setTimeout(() => {
      setNote("Incomplete finalization: no session.closed event.");
      cleanup();
    }, CLOSE_TIMEOUT_MS);
  }

  const live = status === "live";

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
          GPT-Live spike
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
        <label className="flex items-center gap-2 text-xs text-steel">
          Accent
          <input
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            disabled={status !== "standby"}
            maxLength={ACCENT_MAX_LENGTH}
            placeholder="none"
            className="w-36 rounded-md border border-panel-edge bg-panel px-2 py-1 text-xs text-foreground"
          />
        </label>
        <span
          className={`text-[10px] uppercase tracking-[0.3em] ${
            live ? "hud-glow text-cyan-hud" : "text-steel"
          }`}
        >
          {status}
        </span>
        {seconds != null && (
          <span className="text-xs text-steel">
            {seconds}s · ${((seconds / 60) * LIVE_USD_PER_MINUTE).toFixed(3)}
          </span>
        )}
      </div>

      {note && <p className="text-xs text-steel">{note}</p>}

      <audio ref={audioRef} autoPlay controls className="w-full" />

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
          onClick={start}
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
