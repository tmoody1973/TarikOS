# Observability & Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace every Zola tool call and conversation into a self-hosted Arize Phoenix instance, then measure tool-selection accuracy against a labeled dataset.

**Architecture:** Two write paths into Phoenix. During a call, an OpenTelemetry span wraps `runTool` in the single tool webhook route (covering all 23 tools plus cron-initiated calls). After a call, ElevenLabs POSTs a post-call webhook containing the full transcript with `tool_calls` already attached to the turn that produced them; a new route verifies the signature and maps it into a conversation trace. The two never need joining — eval #1 lives entirely inside the conversation trace.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@vercel/otel`, `@opentelemetry/api`, `@arizeai/openinference-semantic-conventions`, `@elevenlabs/elevenlabs-js` (already a dependency), Phoenix on Railway, `node --test` for tests, Python notebook for evals.

## Global Constraints

- **Zero behavior change.** The `ok` flag and `message` string of every tool result must remain byte-for-byte identical. Zola's spoken output must not change.
- **Observability is non-load-bearing.** No tracing failure may propagate into a request. Every span operation is wrapped; failures are logged with `console.error` and swallowed.
- **Never commit real utterances.** This repo is public under MIT. Eval datasets live in Phoenix, only eval code is committed.
- **Full content is traced** — email bodies, journal text, memory content, prompts and completions. Phoenix retention is set to 90 days.
- Package versions verified 2026-08-08: `@vercel/otel@2.1.3`, `@opentelemetry/api@1.9.1`, `@arizeai/openinference-semantic-conventions@2.7.0`.
- Phoenix instance: `https://arize-phoenix-production-434e.up.railway.app` — verified live, auth enforced (401 on unauthenticated OTLP and GraphQL).
- Tests follow the existing `tests/*.test.ts` convention run by `npm test` (`node --test "tests/*.test.ts"`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/instrumentation.ts` (create) | Next.js OTel registration hook. Nothing else. |
| `src/lib/tracing.ts` (create) | Tracer accessor and crash-proof attribute helpers. No domain knowledge. |
| `src/lib/toolOutcome.ts` (create) | Pure classification of a tool result into an outcome enum. |
| `src/lib/phoenixMapper.ts` (create) | Pure mapping of an ElevenLabs post-call payload into span descriptors. |
| `src/app/api/elevenlabs/post-call/route.ts` (create) | Signature verification, fast 200, ship spans via `waitUntil`. |
| `src/app/api/tools/[tool]/route.ts` (modify) | Add span wrapper and outcome tagging. |
| `src/lib/zolaDraft.ts`, `src/lib/consolidate.ts` (modify) | Nested LLM spans with OpenInference conventions. |
| `evals/` (create) | Python notebook and harness. Never runs in production. |

---

### Task 1: Tracing foundation

**Files:**
- Create: `src/instrumentation.ts`
- Create: `src/lib/tracing.ts`
- Test: `tests/instrumentationSafety.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getTracer(): Tracer`, `safeSetAttrs(span: Span | undefined, attrs: Record<string, unknown>): void`, `safeEndSpan(span: Span | undefined, error?: unknown): void`. All three are total functions that never throw.

- [ ] **Step 1: Install dependencies**

```bash
npm install @vercel/otel@2.1.3 @opentelemetry/api@1.9.1 @arizeai/openinference-semantic-conventions@2.7.0
```

- [ ] **Step 2: Write the failing test**

Create `tests/instrumentationSafety.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { safeSetAttrs, safeEndSpan } from "../src/lib/tracing.ts";

// A span stand-in that throws on every call, simulating a broken exporter.
const hostileSpan = {
  setAttribute() { throw new Error("exporter exploded"); },
  setStatus() { throw new Error("exporter exploded"); },
  recordException() { throw new Error("exporter exploded"); },
  end() { throw new Error("exporter exploded"); },
} as never;

test("safeSetAttrs swallows a throwing span", () => {
  assert.doesNotThrow(() => safeSetAttrs(hostileSpan, { "tool.name": "recall" }));
});

test("safeEndSpan swallows a throwing span", () => {
  assert.doesNotThrow(() => safeEndSpan(hostileSpan, new Error("boom")));
});

test("undefined span is a no-op", () => {
  assert.doesNotThrow(() => safeSetAttrs(undefined, { a: 1 }));
  assert.doesNotThrow(() => safeEndSpan(undefined));
});

test("circular objects do not throw", () => {
  const circular: Record<string, unknown> = { name: "x" };
  circular.self = circular;
  const calls: string[] = [];
  const span = {
    setAttribute(k: string) { calls.push(k); },
    setStatus() {}, recordException() {}, end() {},
  } as never;
  assert.doesNotThrow(() => safeSetAttrs(span, { payload: circular }));
});

test("null and undefined values are skipped, not stringified", () => {
  const seen: Record<string, unknown> = {};
  const span = {
    setAttribute(k: string, v: unknown) { seen[k] = v; },
    setStatus() {}, recordException() {}, end() {},
  } as never;
  safeSetAttrs(span, { kept: "yes", skipped: undefined, alsoSkipped: null });
  assert.deepEqual(Object.keys(seen), ["kept"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/lib/tracing.ts`

- [ ] **Step 4: Write `src/lib/tracing.ts`**

```typescript
import { trace, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

// Observability must never break a request. Every helper here is total:
// it logs and returns rather than throwing, no matter what it is handed.

export function getTracer(): Tracer {
  return trace.getTracer("tarik-os");
}

function toAttributeValue(value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Circular or otherwise unserialisable.
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

export function safeEndSpan(span: Span | undefined, error?: unknown): void {
  if (!span) return;
  try {
    if (error !== undefined) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } catch (recordError) {
    console.error("[tracing] recording exception failed:", recordError);
  }
  try {
    span.end();
  } catch (endError) {
    console.error("[tracing] span.end failed:", endError);
  }
}
```

- [ ] **Step 5: Write `src/instrumentation.ts`**

`@vercel/otel` reads `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` from the environment and handles flushing before the function freezes.

```typescript
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "tarik-os" });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests in `instrumentationSafety.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/instrumentation.ts src/lib/tracing.ts tests/instrumentationSafety.test.ts
git commit -m "feat(obs): OpenTelemetry foundation with crash-proof span helpers"
```

---

### Task 2: Tool outcome classifier

**Files:**
- Create: `src/lib/toolOutcome.ts`
- Test: `tests/toolOutcome.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ToolOutcome = "success" | "no_match" | "ambiguous" | "disabled" | "error"` and `classifyOutcome(result: { ok: boolean; outcome?: ToolOutcome }): ToolOutcome`.

**Why this exists:** four sites return `ok: true` for non-results. Without distinguishing them, "she called `update_telos_item` and nothing matched" is recorded as a success and the eval dataset becomes wrong. `ok` is what Zola speaks from and must not change, so the distinction lives in a separate optional field that is stripped before the response is serialized.

- [ ] **Step 1: Write the failing test**

Create `tests/toolOutcome.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome } from "../src/lib/toolOutcome.ts";

test("plain success", () => {
  assert.equal(classifyOutcome({ ok: true }), "success");
});

test("plain failure", () => {
  assert.equal(classifyOutcome({ ok: false }), "error");
});

test("explicit outcome wins over ok:true", () => {
  assert.equal(classifyOutcome({ ok: true, outcome: "no_match" }), "no_match");
  assert.equal(classifyOutcome({ ok: true, outcome: "ambiguous" }), "ambiguous");
  assert.equal(classifyOutcome({ ok: true, outcome: "disabled" }), "disabled");
});

test("explicit outcome wins over ok:false", () => {
  assert.equal(classifyOutcome({ ok: false, outcome: "disabled" }), "disabled");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/lib/toolOutcome.ts`

- [ ] **Step 3: Write `src/lib/toolOutcome.ts`**

```typescript
// A tool call's real outcome, independent of the `ok` flag Zola speaks from.
//
// Four sites in the tool route return `ok: true` for a non-result ("nothing
// matched", "several matched", "no brief ready"), and a disabled tool returns
// HTTP 200. Recording those as successes would corrupt any eval built on this
// data, so callers tag the real outcome explicitly.

export type ToolOutcome =
  | "success"
  | "no_match"
  | "ambiguous"
  | "disabled"
  | "error";

export function classifyOutcome(result: {
  ok: boolean;
  outcome?: ToolOutcome;
}): ToolOutcome {
  if (result.outcome) return result.outcome;
  return result.ok ? "success" : "error";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 4 tests in `toolOutcome.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/toolOutcome.ts tests/toolOutcome.test.ts
git commit -m "feat(obs): tool outcome classifier distinguishing non-results from success"
```

---

### Task 3: Instrument the tool route

**Files:**
- Modify: `src/app/api/tools/[tool]/route.ts`

**Interfaces:**
- Consumes: `getTracer`, `safeSetAttrs`, `safeEndSpan` from Task 1; `classifyOutcome`, `ToolOutcome` from Task 2.
- Produces: spans named `tool.<name>` carrying `tool.name`, `tool.args`, `tool.outcome`, and on failure an exception. All 23 tools and all Convex cron-initiated calls are covered because every call passes through this one function.

- [ ] **Step 1: Add the outcome field to the internal result type**

In `src/app/api/tools/[tool]/route.ts`, add the import and extend `ToolResult`:

```typescript
import { getTracer, safeSetAttrs, safeEndSpan } from "@/lib/tracing";
import { classifyOutcome, type ToolOutcome } from "@/lib/toolOutcome";

// `outcome` is internal-only telemetry. It is stripped before the response is
// serialized so the agent's view of a tool result is unchanged.
type ToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  outcome?: ToolOutcome;
};
```

- [ ] **Step 2: Tag the four non-result sites**

Add `outcome:` to exactly these four returns. Do not touch `ok` or `message`.

`update_calendar_event` not-found (near line 329):

```typescript
      if (res.outcome === "not_found") {
        return {
          ok: true,
          outcome: "no_match",
          message: `No timed event matching "${match}" on ${date}. Ask Tarik which event he means (all-day events can't be moved yet).`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
          outcome: "ambiguous",
          message: `Several events match — ask Tarik which one: ${res.candidates.join("; ")}.`,
        };
      }
```

`get_brief` with no brief (near line 628):

```typescript
      if (!brief) {
        return {
          ok: true,
          outcome: "no_match",
          message:
            "No pre-built brief is ready. Fall back to get_calendar and get_emails for a live briefing.",
        };
      }
```

`update_telos_item` not-found (near line 812):

```typescript
      if (res.outcome === "not_found") {
        return {
          ok: true,
          outcome: "no_match",
          message: `No active telos item matches "${match}". Ask Tarik which item he means.`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
          outcome: "ambiguous",
          message: `Several items match — ask Tarik which one: ${res.candidates.join("; ")}.`,
        };
      }
```

- [ ] **Step 3: Wrap the POST handler body in a span**

Replace the `try { ... } catch { ... }` block inside `POST` with this. The existing error handling is preserved exactly; only span calls and the `outcome` strip are added.

```typescript
  const span = getTracer().startSpan(`tool.${tool}`);
  safeSetAttrs(span, { "tool.name": tool, "tool.args": body });

  try {
    const gate = await convex.query(api.secondBrain.toolGate, {
      secret,
      name: tool,
    });
    if (!gate.allowed) {
      safeSetAttrs(span, { "tool.outcome": "disabled" });
      safeEndSpan(span);
      return NextResponse.json(
        {
          ok: false,
          message: `The ${tool.replace(/_/g, " ")} tool is disabled in the control panel, so it can't be used right now.`,
        },
        { status: 200 },
      );
    }
    const result = await runTool(tool, body, secret, req.nextUrl.origin);
    safeSetAttrs(span, {
      "tool.outcome": classifyOutcome(result),
      "tool.message": result.message,
    });
    safeEndSpan(span);
    // Strip internal telemetry before the agent sees the result.
    const { outcome: _outcome, ...wire } = result;
    return NextResponse.json(wire, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      safeSetAttrs(span, { "tool.outcome": "error", "tool.error_kind": "google_auth" });
      safeEndSpan(span, error);
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 200 },
      );
    }
    safeSetAttrs(span, { "tool.outcome": "error" });
    safeEndSpan(span, error);
    await convex
      .mutation(api.secondBrain.reportToolError, {
        secret,
        name: tool,
        message: error instanceof Error ? error.message : String(error),
      })
      .catch(() => {});
    console.error(`Tool ${tool} failed:`, error);
    return NextResponse.json(
      {
        ok: false,
        message: `The ${tool.replace(/_/g, " ")} tool hit an internal error. Tell Tarik it needs attention in the control panel.`,
      },
      { status: 500 },
    );
  }
```

- [ ] **Step 4: Verify the build and existing tests still pass**

Run: `npm run build && npm test`
Expected: build succeeds, all existing tests pass. No test should change behavior — this task adds telemetry only.

- [ ] **Step 5: Verify a real span reaches Phoenix**

Start the dev server with the Phoenix variables loaded, then fire a real tool call:

```bash
npm run dev
```

In another terminal:

```bash
curl -s -X POST http://localhost:3000/api/tools/get_telos \
  -H "content-type: application/json" \
  -H "x-morpheus-secret: $(grep '^MORPHEUS_TOOL_SECRET=' .env.local | cut -d= -f2-)" \
  -d '{}' | head -c 200
```

Then open the Phoenix UI and confirm a span named `tool.get_telos` appears with `tool.outcome` set. Expected: one span, outcome `success`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/tools/[tool]/route.ts"
git commit -m "feat(obs): trace every tool call with outcome classification"
```

---

### Task 4: LLM spans for Claude calls

**Files:**
- Modify: `src/lib/zolaDraft.ts`
- Modify: `src/lib/consolidate.ts`

**Interfaces:**
- Consumes: `getTracer`, `safeSetAttrs`, `safeEndSpan` from Task 1.
- Produces: child spans under the active tool span, using OpenInference semantic conventions so Phoenix renders prompts and completions natively rather than as opaque attributes.

- [ ] **Step 1: Add the LLM span to `zolaDraft.ts`**

Add imports and wrap the existing `client.messages.create` call. Everything else in the function is unchanged.

```typescript
import { getTracer, safeSetAttrs, safeEndSpan } from "./tracing.ts";
import { SemanticConventions, OpenInferenceSpanKind } from "@arizeai/openinference-semantic-conventions";
```

Replace the API call region with:

```typescript
  const client = new Anthropic();
  const span = getTracer().startSpan("llm.draft_email");
  safeSetAttrs(span, {
    [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.LLM,
    [SemanticConventions.LLM_MODEL_NAME]: "claude-opus-5",
    [SemanticConventions.INPUT_VALUE]: prompt,
  });

  let response;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: BODY_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (error) {
    safeEndSpan(span, error);
    throw error;
  }

  safeSetAttrs(span, {
    [SemanticConventions.OUTPUT_VALUE]:
      response.content.find((b) => b.type === "text")?.type === "text"
        ? JSON.stringify(response.content)
        : "",
    [SemanticConventions.LLM_TOKEN_COUNT_PROMPT]: response.usage?.input_tokens,
    [SemanticConventions.LLM_TOKEN_COUNT_COMPLETION]: response.usage?.output_tokens,
    "llm.stop_reason": response.stop_reason,
  });
  safeEndSpan(span);
```

- [ ] **Step 2: Add the same span to `consolidate.ts`**

In `runConsolidation`, apply the identical pattern with the span named `llm.consolidate_memories`, `LLM_MODEL_NAME` of `claude-opus-5`, and `INPUT_VALUE` set to `buildPrompt(input)`. The `stop_reason === "refusal"` check and both existing throws stay exactly as they are, each preceded by `safeEndSpan(span, error)`.

```typescript
  const client = new Anthropic();
  const prompt = buildPrompt(input);
  const span = getTracer().startSpan("llm.consolidate_memories");
  safeSetAttrs(span, {
    [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.LLM,
    [SemanticConventions.LLM_MODEL_NAME]: "claude-opus-5",
    [SemanticConventions.INPUT_VALUE]: prompt,
  });

  let response;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: OPS_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (error) {
    safeEndSpan(span, error);
    throw error;
  }

  safeSetAttrs(span, {
    [SemanticConventions.LLM_TOKEN_COUNT_PROMPT]: response.usage?.input_tokens,
    [SemanticConventions.LLM_TOKEN_COUNT_COMPLETION]: response.usage?.output_tokens,
    "llm.stop_reason": response.stop_reason,
  });
  safeEndSpan(span);
```

- [ ] **Step 3: Run the existing consolidation tests**

Run: `npm test`
Expected: PASS — `consolidate.test.ts` and `zolaDrafts.test.ts` unchanged. These test the pure helpers (`buildPrompt`, `opsFromResponse`), which this task does not touch.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zolaDraft.ts src/lib/consolidate.ts
git commit -m "feat(obs): OpenInference LLM spans for drafting and consolidation"
```

---

### Task 5: Post-call payload mapper

**Files:**
- Create: `src/lib/phoenixMapper.ts`
- Create: `tests/fixtures/post-call-payload.json`
- Test: `tests/phoenixMapper.test.ts`

**Interfaces:**
- Consumes: nothing. This is a pure function with no I/O so it is fully testable.
- Produces: `type ConversationSpan = { name: string; attributes: Record<string, unknown>; startMs: number; endMs: number; children: ConversationSpan[] }` and `mapPostCall(payload: unknown): ConversationSpan | null`. Returns `null` for anything unrecognisable rather than throwing.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/post-call-payload.json` — a trimmed but structurally faithful ElevenLabs payload:

```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1739537297,
  "data": {
    "agent_id": "agent_abc",
    "conversation_id": "conv_xyz",
    "status": "done",
    "transcript": [
      {
        "role": "user",
        "message": "what did I say about the station project last week?",
        "tool_calls": null,
        "tool_results": null,
        "time_in_call_secs": 2,
        "conversation_turn_metrics": null
      },
      {
        "role": "agent",
        "message": "Let me check your second brain.",
        "tool_calls": [
          { "type": "webhook", "tool_name": "recall", "params_as_json": "{\"query\":\"station project\"}" }
        ],
        "tool_results": [
          { "tool_name": "recall", "result_value": "2 memories found", "is_error": false }
        ],
        "time_in_call_secs": 5,
        "conversation_turn_metrics": {
          "convai_llm_service_ttfb": { "elapsed_time": 0.37 }
        }
      }
    ],
    "metadata": {
      "start_time_unix_secs": 1739537297,
      "call_duration_secs": 22,
      "cost": 296,
      "termination_reason": ""
    },
    "analysis": {
      "call_successful": "success",
      "transcript_summary": "Tarik asked about the station project.",
      "evaluation_criteria_results": {}
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/phoenixMapper.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapPostCall } from "../src/lib/phoenixMapper.ts";

const payload = JSON.parse(
  readFileSync(new URL("./fixtures/post-call-payload.json", import.meta.url), "utf8"),
);

test("maps a conversation to a root span", () => {
  const root = mapPostCall(payload);
  assert.ok(root);
  assert.equal(root.name, "conversation");
  assert.equal(root.attributes["conversation.id"], "conv_xyz");
  assert.equal(root.attributes["conversation.duration_secs"], 22);
  assert.equal(root.attributes["conversation.cost"], 296);
});

test("creates one child span per turn", () => {
  const root = mapPostCall(payload);
  assert.equal(root!.children.length, 2);
  assert.equal(root!.children[0].attributes["turn.role"], "user");
  assert.equal(root!.children[0].attributes["turn.message"], "what did I say about the station project last week?");
});

test("nests tool calls under the turn that made them", () => {
  const root = mapPostCall(payload);
  const agentTurn = root!.children[1];
  assert.equal(agentTurn.children.length, 1);
  assert.equal(agentTurn.children[0].name, "tool.recall");
  assert.equal(agentTurn.children[0].attributes["tool.name"], "recall");
  assert.equal(agentTurn.children[0].attributes["tool.is_error"], false);
});

test("carries per-turn latency when present", () => {
  const root = mapPostCall(payload);
  assert.equal(root!.children[1].attributes["turn.llm_ttfb_secs"], 0.37);
});

test("returns null for a non-transcription event", () => {
  assert.equal(mapPostCall({ type: "post_call_audio", data: {} }), null);
});

test("returns null rather than throwing on garbage", () => {
  assert.equal(mapPostCall(null), null);
  assert.equal(mapPostCall("nope"), null);
  assert.equal(mapPostCall({ type: "post_call_transcription" }), null);
  assert.equal(mapPostCall({ type: "post_call_transcription", data: { transcript: "not-an-array" } }), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/lib/phoenixMapper.ts`

- [ ] **Step 4: Write `src/lib/phoenixMapper.ts`**

```typescript
// Pure mapping of an ElevenLabs post-call payload into span descriptors.
// No I/O and no OpenTelemetry imports, so it is fully testable and cannot
// fail in a way that affects the request.

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

function toolSpans(turn: Turn, startMs: number): ConversationSpan[] {
  if (!Array.isArray(turn.tool_calls)) return [];
  const results = Array.isArray(turn.tool_results) ? turn.tool_results : [];
  return turn.tool_calls.map((call: Record<string, unknown>, i) => {
    const name = typeof call?.tool_name === "string" ? call.tool_name : "unknown";
    const result = results[i] as Record<string, unknown> | undefined;
    return {
      name: `tool.${name}`,
      attributes: {
        "tool.name": name,
        "tool.args": call?.params_as_json,
        "tool.result": result?.result_value,
        "tool.is_error": result?.is_error === true,
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

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const analysis = (data.analysis ?? {}) as Record<string, unknown>;
  const startMs = num(metadata.start_time_unix_secs) * 1000;
  const endMs = startMs + num(metadata.call_duration_secs) * 1000;

  const children: ConversationSpan[] = data.transcript.map((raw) => {
    const turn = (raw ?? {}) as Turn;
    const turnStart = startMs + num(turn.time_in_call_secs) * 1000;
    const metrics = (turn.conversation_turn_metrics ?? {}) as Record<string, unknown>;
    const ttfb = (metrics.convai_llm_service_ttfb ?? {}) as Record<string, unknown>;
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 6 tests in `phoenixMapper.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/phoenixMapper.ts tests/phoenixMapper.test.ts tests/fixtures/post-call-payload.json
git commit -m "feat(obs): pure mapper from ElevenLabs post-call payload to spans"
```

---

### Task 6: Post-call webhook route

**Files:**
- Create: `src/app/api/elevenlabs/post-call/route.ts`
- Modify: `src/proxy.ts` (or the Clerk middleware file — exempt the new path)
- Test: `tests/postCallAuth.test.ts`

**Interfaces:**
- Consumes: `mapPostCall`, `ConversationSpan` from Task 5; `getTracer`, `safeSetAttrs`, `safeEndSpan` from Task 1.
- Produces: `POST /api/elevenlabs/post-call`, and `emitConversationSpans(root: ConversationSpan): void` exported for reuse.

**Note:** `@elevenlabs/elevenlabs-js` is already a dependency. Signature verification uses `elevenlabs.webhooks.constructEvent(rawBody, signature, secret)` with the `elevenlabs-signature` header. The raw body string is required, so read with `req.text()` and never `req.json()`.

- [ ] **Step 1: Write the failing test**

Create `tests/postCallAuth.test.ts`. This tests the pure guard, not the network route:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { shouldProcess } from "../src/lib/phoenixMapper.ts";

test("rejects a missing signature", () => {
  assert.equal(shouldProcess(null, "secret"), false);
});

test("rejects a missing secret", () => {
  assert.equal(shouldProcess("t=1,v0=abc", undefined), false);
});

test("accepts when both are present", () => {
  assert.equal(shouldProcess("t=1,v0=abc", "secret"), true);
});
```

Add to `src/lib/phoenixMapper.ts`:

```typescript
// Cheap precondition check before doing cryptographic verification.
export function shouldProcess(
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  return Boolean(signature) && Boolean(secret);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `shouldProcess` is not exported

- [ ] **Step 3: Write the route**

Create `src/app/api/elevenlabs/post-call/route.ts`:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { waitUntil } from "@vercel/functions";
import { mapPostCall, shouldProcess, type ConversationSpan } from "@/lib/phoenixMapper";
import { getTracer, safeSetAttrs, safeEndSpan } from "@/lib/tracing";

// ElevenLabs post-call webhook. Returns 200 as soon as the signature checks
// out; shipping to Phoenix happens after the response so a slow or dead
// Phoenix never triggers a webhook retry.

function emit(node: ConversationSpan): void {
  const span = getTracer().startSpan(node.name, { startTime: node.startMs });
  safeSetAttrs(span, node.attributes);
  for (const child of node.children) emit(child);
  safeEndSpan(span);
}

export function emitConversationSpans(root: ConversationSpan): void {
  try {
    emit(root);
  } catch (error) {
    console.error("[post-call] emitting spans failed:", error);
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const signature = req.headers.get("elevenlabs-signature");
  if (!shouldProcess(signature, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Raw string body is required for signature verification.
  const raw = await req.text();

  let event: { type?: string };
  try {
    const elevenlabs = new ElevenLabsClient();
    event = await elevenlabs.webhooks.constructEvent(raw, signature!, secret!);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const root = mapPostCall(event);
  if (!root) {
    // Not a transcription event, or a shape we do not map. Acknowledge anyway.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  waitUntil(Promise.resolve().then(() => emitConversationSpans(root)));
  return NextResponse.json({ received: true }, { status: 200 });
}
```

- [ ] **Step 4: Exempt the route from Clerk**

`src/proxy.ts:9` already lists `"/api/tools(.*)"` as a public route because the tool webhooks carry their own shared-secret auth. This webhook is the same case — it authenticates by ElevenLabs signature, not a browser session. Add one line beside it:

```typescript
  "/api/tools(.*)",
  // Signature-authenticated ElevenLabs post-call webhook, not a browser session.
  "/api/elevenlabs(.*)",
```

- [ ] **Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS, build succeeds

- [ ] **Step 6: Verify the route rejects an unsigned request**

```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/elevenlabs/post-call \
  -H "content-type: application/json" -d '{}'
```

Expected: `401`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/elevenlabs/post-call/route.ts src/lib/phoenixMapper.ts tests/postCallAuth.test.ts src/proxy.ts
git commit -m "feat(obs): ElevenLabs post-call webhook to Phoenix conversation traces"
```

---

### Task 7: Wire up production

**Files:** none — configuration only.

**Interfaces:**
- Consumes: the route from Task 6.
- Produces: live traces from production.

- [ ] **Step 1: Add the environment variables to Vercel**

`.env.local` only affects local dev; traces originate from the deployed app.

```bash
vercel env add OTEL_EXPORTER_OTLP_ENDPOINT production
# paste: https://arize-phoenix-production-434e.up.railway.app

vercel env add OTEL_EXPORTER_OTLP_HEADERS production
# paste: Authorization=Bearer <phoenix-api-key>

vercel env add ELEVENLABS_WEBHOOK_SECRET production
# paste: the secret generated in the next step
```

- [ ] **Step 2: Register the webhook in ElevenLabs**

In the ElevenLabs dashboard, add a post-call webhook pointing at `https://<your-vercel-domain>/api/elevenlabs/post-call`, enable the `post_call_transcription` event, and copy the generated signing secret into `ELEVENLABS_WEBHOOK_SECRET`.

- [ ] **Step 3: Deploy**

```bash
vercel --prod
```

- [ ] **Step 4: Verify end to end**

Hold a short voice conversation with Zola that triggers at least one tool (for example, "what's on my calendar today?"). Wait for the call to end.

In Phoenix, confirm two things appear: a `conversation` trace with `turn` children and a nested `tool.get_calendar` span, and a separate `tool.get_calendar` span from the live tool route.

- [ ] **Step 5: Rotate the Phoenix API key**

The key used during setup was pasted into a chat transcript. Generate a fresh one in Phoenix Settings, update Vercel and `.env.local`, and delete the old key.

---

### Task 8: Eval #1 — tool-selection accuracy

**Files:**
- Create: `evals/README.md`
- Create: `evals/tool_selection.ipynb`
- Create: `evals/requirements.txt`

**Interfaces:**
- Consumes: conversation traces produced by Task 6.
- Produces: a Phoenix dataset named `tool-selection-v1` and an accuracy figure with a confusion matrix.

**Prerequisite:** roughly two weeks of normal daily use, so there are real conversations to sample. Do not start this task early with synthetic data.

- [ ] **Step 1: Create the Python environment**

`evals/requirements.txt`:

```
arize-phoenix>=8.0.0
arize-phoenix-client
pandas
scikit-learn
anthropic
```

```bash
cd evals && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
```

- [ ] **Step 2: Write `evals/README.md`**

```markdown
# Evals

Eval code only. **No datasets are committed** — this repository is public and
real utterances are personal data. Datasets live in Phoenix.

Setup:

    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt

Required environment:

    PHOENIX_COLLECTOR_ENDPOINT=https://arize-phoenix-production-434e.up.railway.app
    PHOENIX_API_KEY=<key>
```

- [ ] **Step 3: Pull candidate utterances from Phoenix**

In the notebook, query spans named `turn` where `turn.role == "user"`, together with the tool span (if any) nested under the following agent turn:

```python
import os
import pandas as pd
from phoenix.client import Client

client = Client(
    base_url=os.environ["PHOENIX_COLLECTOR_ENDPOINT"],
    api_key=os.environ["PHOENIX_API_KEY"],
)

spans = client.spans.get_spans_dataframe(project_name="tarik-os")
turns = spans[spans["name"] == "turn"].copy()
tools = spans[spans["name"].str.startswith("tool.")].copy()

print(f"{len(turns)} turns, {len(tools)} tool calls available")
turns.head(20)
```

- [ ] **Step 4: Label 50 utterances**

Export 50 user turns to a local CSV (gitignored), and fill in two columns by hand:

- `expected_tool` — the tool that should have fired, or `none` if she should have answered from standing context
- `acceptable_alternatives` — semicolon-separated; any match counts as correct

The alternatives column is not optional polish. Several utterances genuinely admit two defensible tools, and single-label scoring produces a misleadingly low number that destroys trust in the metric during the first week.

```python
sample = turns.sample(50, random_state=1)[["context.span_id", "attributes.turn.message"]]
sample["expected_tool"] = ""
sample["acceptable_alternatives"] = ""
sample.to_csv("labels.csv", index=False)  # gitignored
```

- [ ] **Step 5: Upload the labeled set to Phoenix as a dataset**

```python
labeled = pd.read_csv("labels.csv")
client.datasets.create_dataset(
    name="tool-selection-v1",
    dataframe=labeled,
    input_keys=["attributes.turn.message"],
    output_keys=["expected_tool", "acceptable_alternatives"],
)
```

- [ ] **Step 6: Score the observational baseline**

```python
def is_correct(row):
    actual = row["actual_tool"] or "none"
    allowed = {row["expected_tool"]}
    if isinstance(row["acceptable_alternatives"], str) and row["acceptable_alternatives"]:
        allowed |= set(a.strip() for a in row["acceptable_alternatives"].split(";"))
    return actual in allowed

scored = labeled.join(actual_tools)   # joined on span id from step 3
scored["correct"] = scored.apply(is_correct, axis=1)
accuracy = scored["correct"].mean()
print(f"tool-selection accuracy: {accuracy:.1%}")
```

- [ ] **Step 7: Produce the confusion matrix**

This is the artifact that tells you what to fix.

```python
from sklearn.metrics import confusion_matrix, classification_report

labels = sorted(set(scored["expected_tool"]) | set(scored["actual_tool"].fillna("none")))
print(classification_report(scored["expected_tool"], scored["actual_tool"].fillna("none"), labels=labels, zero_division=0))
pd.DataFrame(
    confusion_matrix(scored["expected_tool"], scored["actual_tool"].fillna("none"), labels=labels),
    index=labels, columns=labels,
)
```

- [ ] **Step 8: Add `evals/.gitignore` and commit code only**

```bash
printf '.venv/\nlabels.csv\n*.csv\n' > evals/.gitignore
git add evals/README.md evals/requirements.txt evals/tool_selection.ipynb evals/.gitignore
git commit -m "feat(evals): tool-selection accuracy notebook and Phoenix dataset"
```

---

### Task 9: Replay harness

**Files:**
- Create: `evals/replay.py`

**Interfaces:**
- Consumes: the `tool-selection-v1` dataset from Task 8; the tool definitions in `scripts/provision-agent.ts` (read only, never modified).
- Produces: `replay(utterance: str) -> str | None` returning the selected tool name, and a scored run comparable across description edits.

**Why:** the observational baseline can only measure the past. This lets you change a tool description and see the number move in seconds instead of two weeks.

**Known approximation, state it in the README:** this is not the ElevenLabs agent loop — different serving, no audio, and no conversation history unless included. Absolute numbers will differ from production. What transfers is the *delta* when a description changes, which is what iteration acts on.

- [ ] **Step 1: Export the tool definitions to JSON**

Add a small script step that reads `TOOLS` from `scripts/provision-agent.ts` and writes `evals/tools.json`, so the harness always scores the descriptions actually deployed:

```bash
node --experimental-strip-types -e "
  import('./scripts/provision-agent.ts').then(m => {
    console.log(JSON.stringify(m.TOOLS ?? [], null, 2));
  })
" > evals/tools.json
```

If `TOOLS` is not exported, add `export` to its declaration in `scripts/provision-agent.ts`. That is the only change this task makes to that file.

- [ ] **Step 2: Write `evals/replay.py`**

```python
import json, os
import anthropic

client = anthropic.Anthropic()

with open("tools.json") as f:
    RAW = json.load(f)

# Map the ElevenLabs webhook tool shape onto the Anthropic tool shape.
TOOLS = [
    {
        "name": t["name"],
        "description": t["description"],
        "input_schema": t.get("apiSchema", {}).get("requestBodySchema")
        or {"type": "object", "properties": {}},
    }
    for t in RAW
]

PERSONA = open("persona.txt").read()  # paste the PERSONA string, gitignored

def replay(utterance: str) -> str | None:
    """Return the tool the model selects for this utterance, or None."""
    response = client.messages.create(
        model="claude-opus-5",
        max_tokens=512,
        system=PERSONA,
        tools=TOOLS,
        messages=[{"role": "user", "content": utterance}],
    )
    for block in response.content:
        if block.type == "tool_use":
            return block.name
    return None
```

- [ ] **Step 3: Score the whole dataset**

```python
import pandas as pd
labeled = pd.read_csv("labels.csv")
labeled["replayed_tool"] = labeled["attributes.turn.message"].map(lambda u: replay(u) or "none")
print(f"harness accuracy: {labeled.apply(is_correct_replay, axis=1).mean():.1%}")
```

- [ ] **Step 4: Run the loop that teaches the lesson**

Change one tool description in `scripts/provision-agent.ts` — the strongest candidate is whichever pair the confusion matrix shows bleeding into each other. Re-export `tools.json`, rerun the harness, and compare. When a change improves the number, run `node scripts/provision-agent.ts` to deploy it to the live agent.

- [ ] **Step 5: Commit**

```bash
printf 'persona.txt\ntools.json\n' >> evals/.gitignore
git add evals/replay.py evals/.gitignore scripts/provision-agent.ts
git commit -m "feat(evals): replay harness for iterating on tool descriptions"
```

---

## Self-Review

**Spec coverage:** Phoenix hosting (done before this plan, verified in Global Constraints); post-call webhook spine (Tasks 5–7); `runTool` instrumentation (Task 3); nested LLM spans (Task 4); the `outcome` attribute without changing `ok` (Tasks 2–3); Vercel flush via `@vercel/otel` and `waitUntil` (Tasks 1, 6); full-content policy and 90-day retention (Global Constraints, set on Railway); dataset in Phoenix not git (Task 8 Step 8); label schema with `acceptable_alternatives` (Task 8 Step 4); observational plus replay measurement (Tasks 8, 9); metrics including confusion matrix (Task 8 Step 7); four tests (Tasks 1, 2, 5, 6); error handling (Task 1 helpers, Task 6 route). **Spec open question 1 is now resolved** — signature verification uses `elevenlabs.webhooks.constructEvent`.

**Type consistency:** `ToolOutcome` defined in Task 2, consumed in Task 3. `ConversationSpan` defined in Task 5, consumed in Task 6. `getTracer`/`safeSetAttrs`/`safeEndSpan` defined in Task 1, consumed in Tasks 3, 4, 6. `shouldProcess` and `mapPostCall` both live in `phoenixMapper.ts`, consumed in Task 6.

**Known gap, deliberate:** Task 8 requires roughly two weeks of accumulated traces. Tasks 1–7 should be executed now; Tasks 8–9 are gated on real data and should not be started early with synthetic utterances.
