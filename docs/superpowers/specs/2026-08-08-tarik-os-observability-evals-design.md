# Tarik OS — Observability & Evaluation Design

**Date:** 2026-08-08
**Status:** Approved in brainstorming
**Milestone goal:** Phoenix hosted, full instrumentation shipping, and eval #1 (tool-selection accuracy) running.

## What this is

Tarik OS has 23 agent tools and no record of whether Zola picks the right one.

The current instrumentation is a per-tool health dot (`tools.health`, `tools.lastError`) that is
overwritten by the next call and erased entirely by the next success, plus a client-side transcript
log written from `VoiceDock.tsx` with `.catch(() => {})` that dies when the browser tab closes.
There are no tool arguments recorded, no durations, no cron-initiated tool calls, and no signal
anywhere for "that was wrong."

The health dot answers *is this tool broken*. Nothing answers *was this tool the right choice*,
which is where every interesting agent failure lives.

This design adds an observability layer and the first real evaluation, without changing a single
thing about how Zola behaves.

## Decisions made

| Decision | Choice |
|---|---|
| Platform | Arize Phoenix (open source, self-hosted) |
| Why not Langfuse | Course alignment (DeepLearning.AI "Evaluating AI Agents" uses Phoenix) and a far lighter self-host footprint |
| Hosting | Railway one-click template (Phoenix + Postgres-SSL), not a VPS |
| Trace content | Full content, including email bodies, journal text, and memory content |
| Retention | 90 days, via Phoenix's native `PHOENIX_DEFAULT_RETENTION_POLICY_DAYS` |
| Primary trace source | ElevenLabs post-call webhook |
| Correlation strategy | None needed — ElevenLabs attaches `tool_calls` to the turn that produced them |
| First eval | Tool-selection accuracy on ~50 labeled utterances |

## Why the post-call webhook is the spine

The ElevenLabs post-call webhook payload contains, server-side and authoritatively:

- `conversation_id`
- `transcript[]` — every turn with `role`, `message`, **`tool_calls`**, **`tool_results`**,
  `time_in_call_secs`, and `conversation_turn_metrics` (per-turn LLM latency)
- `metadata` — call duration, cost, termination reason
- `analysis` — `call_successful`, `transcript_summary`, `evaluation_criteria_results`

ElevenLabs performs the utterance-to-tool correlation itself. This removes the need to thread a
trace ID from the browser through the agent into every webhook body, which would have required
editing all 23 tool schemas in `provision-agent.ts` and depends on templating user dynamic
variables into request bodies — a capability that could not be confirmed in the ElevenLabs docs.

It also fixes three audit findings as a side effect: missing latency, client-side fragility, and
cron tool calls going unrecorded.

## Architecture

```
   voice conversation
        │
        ├── during the call ──────────────────────────────┐
        │   Zola → POST /api/tools/<name>                  │
        │          runTool() wrapped in an OTel span       │
        │          ├─ tool.name, tool.args                 │
        │          ├─ tool.outcome, duration, error        │
        │          └─ nested spans: external calls         │
        │             Claude (zolaDraft, consolidate)      │
        │             search APIs (research)               │
        │                                                  │
        └── after the call ───────────────────────────────┤
            ElevenLabs → POST /api/elevenlabs/post-call    │
                         verify signature → 200 fast       │
                         waitUntil(ship spans)             │
                         1 trace per conversation          │
                         1 span per turn                   │
                         tool_calls as child spans         │
                                                           ▼
                                          ┌────────────────────────────┐
                                          │  Phoenix (Railway)         │
                                          │  + Postgres-SSL            │
                                          │  auth on · 90-day retention│
                                          └────────────┬───────────────┘
                                                       │
                                          eval notebook (Python, local)
                                          reads traces + labeled dataset
                                          → accuracy, precision/recall,
                                            confusion matrix
```

Convex crons call tools over the same HTTP routes, so scheduled workflows are traced by the same
wrapper with no additional work.

## Components

### 1. Phoenix on Railway

Deployed by the user via the one-click template (`railway.com/deploy/PTHRoq`), which provisions
`arizephoenix/phoenix:latest` plus `postgres-ssl:16` with persistence.

Environment variables to set during the deploy:

```
PHOENIX_ENABLE_AUTH=true
PHOENIX_SECRET=<32+ chars, 1 digit, 1 lowercase>
PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=<strong password>
PHOENIX_DEFAULT_RETENTION_POLICY_DAYS=90
```

Copy back into Vercel afterward:

```
PHOENIX_OTLP_ENDPOINT=https://<railway-domain>/v1/traces
PHOENIX_API_KEY=<generated in the Phoenix UI>
```

Use HTTP/protobuf OTLP rather than gRPC — it passes through platform proxies without special
handling, and at single-user volume the performance difference is irrelevant.

### 2. `src/lib/tracing.ts` (new)

Tracer setup via `@vercel/otel`. Exports a `withSpan` helper. Every span operation is wrapped so a
tracing failure can never propagate into a request.

### 3. `src/lib/toolOutcome.ts` (new, pure)

Classifies a tool result into `success | no_match | ambiguous | disabled | error`.

**This does not change the `ok` contract.** The audit found four sites returning `ok: true` for
non-results, which would poison the dataset:

| Site | Case |
|---|---|
| `route.ts:107-115` | disabled tool returns HTTP 200 + `ok:false` |
| `route.ts:329-340` | `update_calendar_event` not-found / ambiguous |
| `route.ts:812-823` | `update_telos_item` not-found / ambiguous |
| `route.ts:628-633` | `get_brief` with no brief available |

`ok` is what Zola reacts to and speaks from. Changing it changes her behavior, which is out of
scope for an observability change. The `outcome` attribute lives on the span only. Spoken behavior
stays byte-for-byte identical.

### 4. `src/lib/phoenixMapper.ts` (new, pure)

Maps an ElevenLabs post-call payload into OpenInference spans. Pure function, no I/O, fully
testable against a saved fixture.

### 5. `src/app/api/elevenlabs/post-call/route.ts` (new)

Verifies the ElevenLabs webhook signature, returns 200 immediately, then ships spans via
`waitUntil` from `@vercel/functions` (already a dependency).

Returning 200 before shipping is deliberate: a slow or unreachable Phoenix must never cause
ElevenLabs to retry into a dead backend.

### 6. `runTool` wrapper in `src/app/api/tools/[tool]/route.ts`

One wrapper covers all 23 tools because every tool call passes through this single function.

Nested spans wrap the external calls inside: Claude in `zolaDraft.ts` and `consolidate.ts`, and the
Tavily/Brave search calls in `research.ts`. Claude spans use OpenInference LLM semantic conventions
so Phoenix renders prompt and completion natively; search calls are plain spans.

### 7. Eval notebook + replay harness

Python, following the DeepLearning.AI course. Lives in `evals/`, never runs in production.

## The Vercel flush problem

Serverless functions can freeze the moment they return, killing in-flight span exports. This is the
most common way OpenTelemetry setups silently record nothing on Vercel.

Mitigations, both already available: `@vercel/otel` for tracer setup, and `waitUntil` from
`@vercel/functions` for the webhook route.

## Data policy

Full content is shipped: utterances, Zola's replies, tool arguments, email bodies pulled into draft
context, journal entries, memory content, and every Claude prompt and completion.

This includes **email written by third parties who did not opt into being on an eval server**. It is
the same data already in Gmail and it sits on infrastructure the user controls, but it justifies the
90-day retention policy rather than indefinite retention. Phoenix enforces this natively.

Auth is on from the first deploy, not added later.

## Eval #1 — tool-selection accuracy

### Dataset

~50 utterances drawn from real traces after roughly two weeks of normal use.

**The dataset lives in Phoenix, not in git.** This repository is public under MIT; committing real
utterances would publish them. Phoenix has datasets as a first-class feature. Only eval *code* is
committed.

Label schema:

| Field | Notes |
|---|---|
| `utterance` | verbatim |
| `expected_tool` | tool name, or `none` when she should have answered from standing context |
| `acceptable_alternatives` | list; any match counts as correct |

The `acceptable_alternatives` field is not optional polish. Some utterances have two defensible
tools, and single-label scoring produces a misleadingly low number that destroys trust in the metric
during the first week.

### Two measurement modes

**Observational** — score what actually happened across real conversation traces. This is the true
baseline. It can only measure the past.

**Replay harness** — feed the same 23 tool definitions and the same persona prompt to a direct
Anthropic call with an utterance, and observe the selection. Change a description in
`provision-agent.ts`, rerun all 50, see the number move in seconds.

**Known approximation:** the harness is not the ElevenLabs agent loop. Different serving, no audio,
and conversation history only if explicitly included. Absolute numbers will differ from production.
What transfers is the *delta* when a description changes, which is what iteration acts on. Use
production traces for the baseline and the harness for iteration.

### Metrics

Overall accuracy; per-tool precision and recall to expose over- and under-called tools; and a
confusion matrix, which is the artifact that indicates what to fix.

## Error handling

The observability layer is strictly non-load-bearing. If it can take down Zola it is worse than
having none.

- Every span operation is wrapped. Failures are swallowed **but logged** — deliberately unlike the
  silent `.catch(() => {})` blocks found in the audit, where errors vanished entirely.
- Phoenix unreachable: spans are dropped, the app is unaffected. No retries, no queue, no
  backpressure into the request path.
- Invalid webhook signature: 401, no processing, logged.
- Webhook received while Phoenix is down: still return 200, log the drop.
- Malformed payload: logged and acknowledged, never thrown.

## Testing

Four `node --test` files matching the existing `tests/` convention, all against pure functions:

| File | Asserts |
|---|---|
| `tests/phoenixMapper.test.ts` | payload-to-spans mapping against a real webhook fixture |
| `tests/toolOutcome.test.ts` | outcome classification for all five cases, including the four `ok:true` sites |
| `tests/postCallAuth.test.ts` | invalid signature is rejected |
| `tests/instrumentationSafety.test.ts` | the mapper returns rather than throws on malformed and hostile input |

The last is the same species as the existing no-send and credential-free-browsing tests: an
invariant enforced by the suite rather than by intention. "Telemetry crashed the assistant" is
exactly the failure this architecture would otherwise permit.

## Non-goals

- No changes to `VoiceDock.tsx`
- No changes to the 23 tool schemas in `provision-agent.ts` (the replay harness reads them, does not modify them)
- No changes to Zola's persona prompt
- No new Convex tables or schema changes
- No change to the `ok` contract or any spoken behavior
- Ritual-compliance and memory-precision evals are deliberately deferred to a second milestone

## Open questions

1. **ElevenLabs webhook signature scheme** — the exact HMAC construction must be confirmed against
   ElevenLabs documentation during implementation. The design assumes signature verification is
   available; if it is not, the route falls back to a shared secret in a header, matching the
   existing `x-morpheus-secret` pattern.
2. **`analysis.evaluation_criteria_results`** — ElevenLabs supports native evaluation criteria
   defined on the agent, and results ride along in every webhook payload. The field is mapped
   through now; whether to define criteria and use it as a complementary eval layer is deferred.
3. **Harness fidelity** — the gap between replay-harness accuracy and observed production accuracy
   is itself worth measuring once both exist.
