import { trace, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

// Observability must never break a request. Every helper here is total: it
// logs and returns rather than throwing, no matter what it is handed. A
// tracing failure that took down a tool call would be worse than having no
// tracing at all — see tests/instrumentationSafety.test.ts.

export function getTracer(): Tracer {
  return trace.getTracer("tarik-os");
}

// OpenTelemetry attributes accept only primitives. Objects are serialized;
// anything unserialisable (circular, BigInt) is labelled rather than thrown.
function toAttributeValue(value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export function safeSetAttrs(
  span: Span | undefined,
  attrs: Record<string, unknown>,
): void {
  if (!span) return;
  for (const [key, raw] of Object.entries(attrs)) {
    const value = toAttributeValue(raw);
    if (value === undefined) continue;
    try {
      span.setAttribute(key, value);
    } catch (error) {
      console.error(`[tracing] setAttribute(${key}) failed:`, error);
    }
  }
}

// endTimeMs is used when replaying historical spans (the ElevenLabs post-call
// webhook arrives after the conversation is over, so wall-clock end times would
// collapse every turn to the moment the webhook landed).
export function safeEndSpan(
  span: Span | undefined,
  error?: unknown,
  endTimeMs?: number,
): void {
  if (!span) return;
  if (error !== undefined) {
    try {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
    } catch (recordError) {
      console.error("[tracing] recording exception failed:", recordError);
    }
  }
  try {
    span.end(endTimeMs);
  } catch (endError) {
    console.error("[tracing] span.end failed:", endError);
  }
}
