import { z } from "zod";
import type { ConversationSpan } from "../phoenixMapper";
import { LIVE_MODEL, LIVE_USD_PER_MINUTE } from "./liveSession.ts";

/* Pure mapping of a GPT-Live session's timeline into the same span tree the
 * ElevenLabs post-call webhook produced, so Phoenix shows one shape of
 * conversation regardless of provider. In the browser the hook collects the
 * timeline and posts it; the phase 3 phone sideband builds the same payload
 * server-side and calls mapLiveCall directly. */

const turnSchema = z.object({
  role: z.enum(["tarik", "morpheus"]),
  text: z.string(),
  startMs: z.number().finite(),
  endMs: z.number().finite(),
});

const toolSchema = z.object({
  name: z.string().min(1),
  args: z.unknown(),
  ok: z.boolean(),
  startMs: z.number().finite(),
  endMs: z.number().finite(),
  result: z.string().max(4000),
});

export const livePostCallSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.number().finite(), // unix ms
  seconds: z.number().finite(), // final usage.seconds from session.closed
  reason: z.string(),
  voice: z.string(),
  transport: z.enum(["webrtc", "sip"]),
  turns: z.array(turnSchema).max(2000),
  tools: z.array(toolSchema).max(500),
});

export type LiveTurn = z.infer<typeof turnSchema>;
export type LiveToolCall = z.infer<typeof toolSchema>;
export type LivePostCall = z.infer<typeof livePostCallSchema>;

const SPAN_KIND = "openinference.span.kind";

export function mapLiveCall(call: LivePostCall): ConversationSpan {
  const t0 = call.startedAt;
  const tools: ConversationSpan[] = call.tools.map((c) => ({
    name: `tool.${c.name}`,
    attributes: {
      [SPAN_KIND]: "TOOL",
      "tool.name": c.name,
      "tool.args": JSON.stringify(c.args ?? {}),
      "tool.result": c.result,
      "tool.is_error": !c.ok,
    },
    startMs: t0 + c.startMs,
    endMs: t0 + c.endMs,
    children: [],
  }));
  // A tool belongs to the turn during which it started; the assistant's
  // spoken result comes later.
  const turns: ConversationSpan[] = call.turns.map((t, i) => {
    const next = call.turns[i + 1];
    const owns = tools.filter((s) => {
      const at = s.startMs - t0;
      return at >= t.startMs && (!next || at < next.startMs);
    });
    return {
      name: "turn",
      attributes: {
        [SPAN_KIND]: "CHAIN",
        "turn.role": t.role === "tarik" ? "user" : "agent",
        "turn.message": t.text,
      },
      startMs: t0 + t.startMs,
      endMs: t0 + t.endMs,
      children: owns,
    };
  });
  return {
    name: "conversation",
    attributes: {
      [SPAN_KIND]: "AGENT",
      "conversation.id": call.sessionId,
      "conversation.provider": "openai",
      "conversation.model": LIVE_MODEL,
      "conversation.transport": call.transport,
      "conversation.voice": call.voice,
      "conversation.status": call.reason,
      "conversation.duration_secs": call.seconds,
      "conversation.cost": Number(((call.seconds / 60) * LIVE_USD_PER_MINUTE).toFixed(4)),
      "conversation.termination_reason": call.reason,
    },
    startMs: t0,
    endMs: t0 + call.seconds * 1000,
    children: turns,
  };
}
