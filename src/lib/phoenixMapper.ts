// Pure mapping of an ElevenLabs post-call payload into span descriptors.
//
// No I/O and no OpenTelemetry imports, so it is fully testable and cannot fail
// in a way that affects a request. Emitting the descriptors is the route's job.
//
// This is the piece that makes tool-selection eval possible: ElevenLabs attaches
// tool_calls to the turn that produced them, so the utterance-to-tool
// correlation arrives done, server-side, and survives a closed browser tab.
// Their *results* arrive on a later turn and are joined here by request_id —
// see resultsByRequestId.

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

/* Phoenix classifies spans by this attribute; without it everything renders as
 * "unknown" and any eval filtering on span_kind silently matches nothing. The
 * literal string is deliberate — this module stays import-free so tests can
 * load it directly under node --test. */
const SPAN_KIND = "openinference.span.kind";

/* Results do NOT live on the turn that made the call. Verified against a real
 * conversation (conv_0601kzheqverfjavgd203js1cy85): the calling turn carries
 * `tool_results: []`, and the results arrive on a later agent turn, joined by
 * `request_id`. Pairing by index within one turn finds nothing — which made
 * `tool.is_error` structurally incapable of ever being true. */
function resultsByRequestId(transcript: unknown[]): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of transcript) {
    const results = obj(raw).tool_results;
    if (!Array.isArray(results)) continue;
    for (const entry of results) {
      const result = obj(entry);
      if (typeof result.request_id === "string") byId.set(result.request_id, result);
    }
  }
  return byId;
}

function toolSpans(
  turn: Turn,
  startMs: number,
  results: Map<string, Record<string, unknown>>,
): ConversationSpan[] {
  if (!Array.isArray(turn.tool_calls)) return [];
  return turn.tool_calls.map((raw) => {
    const call = obj(raw);
    const name = typeof call.tool_name === "string" ? call.tool_name : "unknown";
    const result =
      typeof call.request_id === "string" ? results.get(call.request_id) : undefined;

    // A call whose result never arrived is its own outcome. Reporting
    // is_error: false here would record a non-result as a success — the exact
    // thing convex-side toolOutcome exists to prevent.
    const outcome = result
      ? {
          "tool.result": result.result_value,
          "tool.is_error": result.is_error === true,
          "tool.is_blocked": result.is_blocked === true,
          "tool.error_type": result.error_type || undefined,
          "tool.error_message": result.raw_error_message || undefined,
        }
      : { "tool.no_result": true };

    return {
      name: `tool.${name}`,
      attributes: {
        [SPAN_KIND]: "TOOL",
        "tool.name": name,
        "tool.args": call.params_as_json,
        ...outcome,
      },
      startMs,
      endMs: startMs + num(result?.tool_latency_secs) * 1000,
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

  const results = resultsByRequestId(data.transcript);

  const children: ConversationSpan[] = data.transcript.map((raw) => {
    const turn = obj(raw) as Turn;
    const turnStart = startMs + num(turn.time_in_call_secs) * 1000;
    const metrics = obj(turn.conversation_turn_metrics);
    const ttfb = obj(metrics.convai_llm_service_ttfb);
    return {
      name: "turn",
      attributes: {
        [SPAN_KIND]: "CHAIN",
        "turn.role": turn.role,
        "turn.message": turn.message,
        "turn.llm_ttfb_secs": ttfb.elapsed_time,
      },
      startMs: turnStart,
      endMs: turnStart,
      children: toolSpans(turn, turnStart, results),
    };
  });

  return {
    name: "conversation",
    attributes: {
      [SPAN_KIND]: "AGENT",
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
