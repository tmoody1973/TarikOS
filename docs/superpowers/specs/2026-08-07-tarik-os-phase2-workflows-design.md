# Tarik OS Phase 2 — Workflows & Living Briefs Design

**Date:** 2026-08-07
**Status:** Approved in brainstorming; pending written-spec review
**Linear:** MOO-481 (brainstorm placeholder → will spawn build issues)

## What this is

Phase 2 brings Cloudflare-OS-inspired capability to Morpheus: **deterministic
workflows** (known step-sequences over existing tools, triggered on schedule
or by voice) producing **living brief documents** (persistent, source-linked,
refreshable, live-updating), plus a **multi-page dashboard with
voice-controlled navigation**. Cloudflare OS itself is not portable (Workers/
Durable-Objects-bound); we adopt its concepts on the existing stack.

Deferred to later phases: research workspaces with sandboxed code execution
(Vercel Sandbox), continuous per-source reactivity, proactive audio, mem0.

## Decisions made

| Decision | Choice |
|---|---|
| First slice | Workflow engine → living briefs (2 of 3 CF-OS pillars) |
| Flagship workflows | Both: scheduled morning brief AND on-demand research brief |
| Engine | Convex-native: workflows as data, Convex scheduler triggers, steps call existing `/api/tools/*` routes with the tool secret |
| Brief living-ness | Refresh on schedule/demand (no continuous source-watching in v1) |
| Proactivity | Silent until engaged — brief waits on dashboard; "good morning" speaks from it |
| Memory layer | Own consolidation workflow + Convex vector search (mem0 = documented escape hatch; OSS self-host rejected for infra cost, hosted for data custody) |
| UI | Multi-page app (Home, Briefs, Second Brain, Control Panel), LCARS rail as nav, ElevenLabs client tool for voice navigation |

## Architecture

```
Convex scheduler (cron weekdays 7:00 CT · runAt for on-demand)
        │
        ▼
  runWorkflow action ──HTTP (x-morpheus-secret)──▶ /api/tools/* (existing)
        │                                            calendar · emails · research
        ▼
  briefs table ←─ sections written as steps complete; status building→ready
        │ live query
        ▼
  Briefs page (+ get_brief voice tool reads the same document)
```

Steps run through the existing tool routes, so tool gating (enable/disable),
health, and error reporting apply identically to scheduled and voice-invoked
runs.

## Data model (new Convex tables)

- **workflows** — `name` (unique), `trigger` (`{type:"cron", schedule}` |
  `{type:"voice"}`), `steps` (ordered `{tool, args}`; args support templates
  `{{today}}`, `{{topics}}`, `{{topic}}`), `enabled`, `lastRunAt`,
  `lastError`.
- **briefs** — `title`, `workflowName`, `status`
  (`building | ready | error`), `sections`: ordered `{heading, body
  (markdown), sources [{title,url}], tool, updatedAt}`.
- **settings** — small key-value store; v1 key: `briefTopics` (standing
  research topics for the morning brief; seeded at build time with Tarik).

Seeded workflows:
1. `morning-brief` — cron weekdays 7:00 America/Chicago: get_calendar →
   get_emails → web_research per standing topic → assemble brief.
2. `research-brief` — voice-triggered with `{topic}`: 2–3 web_research
   queries derived from the topic → assemble brief.
3. `memory-consolidation` (milestone 3) — nightly: Claude processes the
   day's transcripts → extract new memories, update stale ones, merge
   duplicates → memories table.

## Workflow runner

Convex action `runWorkflow(name, params?)`:
- Resolves the workflow, checks `enabled`.
- Creates/patches the brief doc (`status: building`), then walks steps in
  order, calling each tool route; **each completed step patches its section
  immediately** (the open page repopulates live mid-build).
- A failed step writes an error section ("Email fetch failed: …") and
  continues — a partial brief beats no brief. Workflow `lastError` records
  the failure for the control panel.
- Sets `status: ready` (or `error` if every step failed).
- A watchdog scheduled function marks briefs stuck `building` >5 min as
  `error`.

## Voice tools (agent additions)

- **run_workflow** `{name, topic?}` (webhook) — fire-and-return: "On it —
  building on your Briefs page." Kicks the Convex action; no dead air.
- **get_brief** `{}` (webhook) — latest `ready` brief's sections, so
  "good morning" is answered from the pre-built brief instantly. No ready
  brief → Morpheus falls back to live get_calendar/get_emails.
- **navigate_ui** `{page, target?}` (**client tool**, executes in browser) —
  pages: home | briefs | brain | conversations | control; `target` opens a
  specific brief. Router pushes via next/navigation.

Persona additions: prefer get_brief for briefings; run_workflow for "build
me a brief on…"; navigate_ui when Tarik asks to see something; never
pretend a disabled/failed workflow succeeded.

## UI

- LCARS rail becomes real navigation (Home, Briefs, Second Brain, Control
  Panel); current single-screen HUD becomes **Home** (voice link + command
  center).
- **Briefs**: list (status, date, workflow) + reader — markdown sections
  with source links, per-brief Refresh button (re-runs its workflow).
- **Second Brain**: existing memories/thoughts/search plus a full
  transcript reader.
- **Control Panel**: existing tool toggles plus a workflows section —
  enabled toggle, last run, last error, "Run now".
- Voice link stays mounted across page navigation (conversation survives
  route changes — layout-level provider).

## Memory consolidation & semantic recall (milestone 3)

- Nightly workflow: fetch day's transcripts → Claude (Anthropic API,
  server-side) extracts durable facts, updates contradicted memories,
  merges duplicates; writes with provenance (transcriptId).
- Recall upgrade: Convex vector search index on memories/thoughts with
  embeddings (provider chosen at plan time; OpenAI or Voyage — smallest
  adequate model); `recall` tool and dashboard search move from full-text
  to hybrid (vector + text).
- mem0 (github.com/mem0ai/mem0, Apache-2.0) is the named upgrade path if
  extraction quality disappoints; memories remain one table behind one
  interface to keep that migration a table-export.

## Error handling

- Workflow failures land in the brief (error sections) and in
  `workflows.lastError` (control panel) — never silent.
- get_brief fallback covers missing/failed briefs.
- Voice navigation to an unknown page/target → Morpheus says so.

## Testing

- Unit: workflow runner (step ordering, partial failure, section patching,
  watchdog), template resolution, consolidation prompt I/O shape (mocked
  Claude).
- Existing text-mode/tool-route tests extend to the three new webhook
  tools.
- Voice E2E manual, per milestone verification checklists.

## Milestones (→ Linear issues)

1. **Engine + morning brief** — tables, runner, cron, Briefs page
   (skeleton), get_brief; verify: 7am brief exists before engagement,
   "good morning" answered from it instantly.
2. **On-demand briefs + voice navigation** — run_workflow, navigate_ui
   client tool, full page navigation, control-panel workflows section;
   verify: "build me a brief on X" → document appears and populates live;
   "show me my briefs" navigates by voice.
3. **Memory consolidation + semantic recall** — nightly workflow, vector
   search; verify: an unprompted fact from a day's conversation is
   recalled next day; a contradicted memory is updated not duplicated.

## Explicitly not in this phase

- Sandboxed code-execution research workspaces (Vercel Sandbox) — next
  phase candidate
- Continuous source-watching briefs; proactive audio
- Export to Google Drive/slides/spreadsheet formats (briefs are web docs
  first; export is a later increment)
- mem0 integration; Humalike; MCP adapter
