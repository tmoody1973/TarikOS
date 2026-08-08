import { ROOT_CONTEXT, trace, type Context, type Tracer } from "@opentelemetry/api";
import { getTracer, safeSetAttrs, safeEndSpan } from "./tracing.ts";
import type { ConversationSpan } from "./phoenixMapper.ts";

// Walks a mapped conversation tree and emits it as real OpenTelemetry spans.
//
// Parentage is threaded EXPLICITLY rather than through context.with(). Two
// reasons, and the second is the one that bites:
//
//   1. startSpan() with no parent context creates a ROOT span every time, so
//      each turn and tool call would land in Phoenix as an unrelated top-level
//      span and the conversation would render as a flat pile, not a tree.
//   2. context.with() depends on an ambient context manager that only exists
//      once an SDK has registered one. Explicit contexts work identically with
//      or without it — including under `node --test`, which is why this is
//      testable at all.
//
// Start and end times come from the payload rather than the clock: the webhook
// arrives after the call is over, so wall-clock timing would collapse every
// turn onto the moment the webhook landed.

// ROOT_CONTEXT, not context.active(): a conversation must be its own trace.
// Emission happens inside waitUntil, where the active context is still the
// webhook's HTTP request — inheriting it would bury every conversation inside
// a "POST /api/elevenlabs/post-call" span, so eval queries would have to dig
// through webhook traces to find conversations instead of reading them
// directly as top-level traces.
export function emitConversationSpans(
  node: ConversationSpan,
  tracer: Tracer = getTracer(),
): void {
  try {
    emit(node, tracer, ROOT_CONTEXT);
  } catch (error) {
    console.error("[emitSpans] emitting conversation spans failed:", error);
  }
}

function emit(node: ConversationSpan, tracer: Tracer, parentCtx: Context): void {
  const span = tracer.startSpan(node.name, { startTime: node.startMs }, parentCtx);
  safeSetAttrs(span, node.attributes);
  if (node.children.length > 0) {
    const childCtx = trace.setSpan(parentCtx, span);
    for (const child of node.children) emit(child, tracer, childCtx);
  }
  safeEndSpan(span, undefined, node.endMs);
}
