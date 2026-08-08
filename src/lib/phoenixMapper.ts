// Pure mapping of an ElevenLabs post-call payload into span descriptors.
//
// No I/O and no OpenTelemetry imports, so it is fully testable and cannot fail
// in a way that affects a request. Emitting the descriptors is the route's job.
//
// This is the piece that makes tool-selection eval possible: ElevenLabs already
// attaches tool_calls and tool_results to the turn that produced them, so the
// utterance-to-tool correlation arrives done, server-side, and survives a
// closed browser tab.

export type ConversationSpan = {
  name: string;
  attributes: Record<string, unknown>;
  startMs: number;
  endMs: number;
  children: ConversationSpan[];
};

type Turn = {
  role?: unknown;
  message?: unknown;
  tool_calls?: unknown;
  tool_results?: unknown;
  time_in_call_secs?: unknown;
  conversation_turn_metrics?: unknown;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toolSpans(turn: Turn, startMs: number): ConversationSpan[] {
  if (!Array.isArray(turn.tool_calls)) return [];
  const results = Array.isArray(turn.tool_results) ? turn.tool_results : [];
  return turn.tool_calls.map((raw, i) => {
    const call = obj(raw);
    const name = typeof call.tool_name === "string" ? call.tool_name : "unknown";
    const result = obj(results[i]);
    return {
      name: `tool.${name}`,
      attributes: {
        "tool.name": name,
        "tool.args": call.params_as_json,
        "tool.result": result.result_value,
        "tool.is_error": result.is_error === true,
      },
      startMs,
      endMs: startMs,
      children: [],
    };
  });
}

export function mapPostCall(payload: unknown): ConversationSpan | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.type !== "post_call_transcription") return null;

  const data = root.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.transcript)) return null;

  const metadata = obj(data.metadata);
  const analysis = obj(data.analysis);
  const startMs = num(metadata.start_time_unix_secs) * 1000;
  const endMs = startMs + num(metadata.call_duration_secs) * 1000;

  const children: ConversationSpan[] = data.transcript.map((raw) => {
    const turn = obj(raw) as Turn;
    const turnStart = startMs + num(turn.time_in_call_secs) * 1000;
    const metrics = obj(turn.conversation_turn_metrics);
    const ttfb = obj(metrics.convai_llm_service_ttfb);
    return {
      name: "turn",
      attributes: {
        "turn.role": turn.role,
        "turn.message": turn.message,
        "turn.llm_ttfb_secs": ttfb.elapsed_time,
      },
      startMs: turnStart,
      endMs: turnStart,
      children: toolSpans(turn, turnStart),
    };
  });

  return {
    name: "conversation",
    attributes: {
      "conversation.id": data.conversation_id,
      "conversation.agent_id": data.agent_id,
      "conversation.status": data.status,
      "conversation.duration_secs": metadata.call_duration_secs,
      "conversation.cost": metadata.cost,
      "conversation.termination_reason": metadata.termination_reason,
      "conversation.successful": analysis.call_successful,
      "conversation.summary": analysis.transcript_summary,
      // Mapped through now; whether to define criteria on the agent is deferred.
      "conversation.evaluation_criteria": analysis.evaluation_criteria_results,
    },
    startMs,
    endMs,
    children,
  };
}

// Cheap precondition check before doing cryptographic verification.
export function shouldProcess(
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  return Boolean(signature) && Boolean(secret);
}
