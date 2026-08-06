# Tarik OS — Morpheus Design

**Date:** 2026-08-06
**Status:** Approved in brainstorming; pending written-spec review

## What this is

Tarik OS is a standalone web app: a real-time, speech-to-speech personal AI
assistant named **Morpheus** (continuing the existing PAI persona and
ElevenLabs voice), plus a live dashboard. Morpheus acts as chief of staff,
second brain, and thought partner. It is independent of the PAI/Claude Code
runtime — a fresh product with its own agent brain and state.

## Decisions made

| Decision | Choice |
|---|---|
| Foundation | Standalone new app (not a PAI layer) |
| Interaction | Voice-first, real-time speech-to-speech |
| Platform | Web app — Next.js on Vercel |
| Voice architecture | ElevenLabs Agents platform + Claude as the LLM brain |
| State/memory/dashboard sync | Convex |
| Assistant name | Morpheus |
| V1 north star | End-to-end thin slice: briefing + thought capture + live research in one conversation |

## Architecture

Four pieces, each with one job:

```
┌─────────────────────────────────────────────────┐
│  TARIK OS  (Next.js web app, Vercel)            │
│                                                 │
│  ┌──────────────┐   ┌────────────────────────┐  │
│  │ Voice HUD    │   │ Dashboard              │  │
│  │ (ElevenLabs  │   │ command center ·       │  │
│  │  React SDK)  │   │ transcript · brain ·   │  │
│  │              │   │ control panel          │  │
│  └──────┬───────┘   └───────────▲────────────┘  │
└─────────┼───────────────────────┼───────────────┘
          │ WebRTC                │ live sync
          ▼                       │
┌───────────────────┐   ┌─────────┴───────────────┐
│ ElevenLabs Agents │   │ CONVEX (the state)      │
│ STT · turn-taking │──▶│ memories · notes ·      │
│ · Morpheus voice ·│   │ transcripts · briefing  │
│ Claude as LLM     │   │ · tool registry         │
└─────────┬─────────┘   └─────────▲───────────────┘
          │ tool calls (webhooks) │
          ▼                       │
┌─────────────────────────────────┴───────────────┐
│ TOOL LAYER (Next.js API routes)                 │
│ calendar · gmail · capture_thought ·            │
│ recall_memory · web_research (AgentKey) ·       │
│ custom tool slots (MCP-style, add over time)    │
└─────────────────────────────────────────────────┘
```

Conversation flow: Tarik speaks → ElevenLabs handles STT and end-of-turn
detection → Claude (configured as the agent's custom LLM) replies or calls a
tool → tool calls hit Next.js webhook routes, which read/write Convex →
Convex pushes changes to the dashboard live → the reply returns as speech in
the Morpheus voice. The dashboard updates while Morpheus talks (Convex
subscriptions), producing the Iron Man HUD effect.

**Key property:** ElevenLabs owns the voice loop; Convex owns all state. If
the voice transport is ever replaced (e.g., self-hosted LiveKit later),
memory, tools, and dashboard are untouched.

## Components

### 1. Voice HUD (frontend)
- ElevenLabs React SDK; WebRTC mic connection to the agent.
- Shows voice state (listening / thinking / speaking), live transcript,
  and in-flight tool activity ("checking your calendar…").

### 2. Dashboard (frontend)
Four roles, all backed by Convex live queries:
- **Live conversation surface** — transcript, current tool calls, voice state.
- **Daily command center** — today's calendar, flagged emails, briefing,
  updated by Morpheus as things change.
- **Second-brain explorer** — browse/search captured thoughts, memories,
  past conversations, and links between them.
- **System control panel** — tool registry (enable/disable), tool health,
  last errors, auth status.

V1 leads with the conversation surface + command center; explorer and control
panel start minimal and deepen in later phases.

### 3. Second brain (Convex)
- **Memories** — facts Morpheus learns ("prefers morning meetings"), written
  by a `remember` tool; typed (preference, fact, project, person); embedded
  for semantic search (Convex built-in vector search; no separate vector DB).
- **Thoughts/notes** — voice-captured via `capture_thought`; stored raw +
  cleaned, tagged, embedded, linkable.
- **Transcripts** — every conversation stored in full and searchable.
- **Recall** — `recall` tool does semantic search across all three. At
  conversation start, a small standing context (top facts, date, active
  projects) is injected so Morpheus never starts cold.

### 4. Tool layer (Next.js API routes)
Every capability is a tool: name, description, JSON parameter schema,
registered with the ElevenLabs agent as a webhook. One uniform pattern.

**V1 tools:**
- `get_calendar`, `get_emails` — Google Calendar/Gmail (chief of staff)
- `capture_thought`, `remember`, `recall` — Convex (second brain)
- `web_research` — AgentKey unified gateway (live search/data)
- `update_dashboard` — push a card/briefing to the HUD

**Plug-in system:** a tool registry in Convex (name, schema, endpoint,
enabled flag). The control panel reads it; adding a custom tool = one API
route + one registry entry. An MCP adapter route (proxying to arbitrary MCP
servers) makes the MCP ecosystem plug-compatible later.

**Auth/security:** Google OAuth for Calendar/Gmail; secrets in Vercel env
vars; every webhook verifies the ElevenLabs signature; single-user app —
dashboard behind login.

## The thin-slice north star (v1 acceptance scenario)

One conversation proving all three pillars:

1. "Good morning, Morpheus." → `get_calendar` + `get_emails` → spoken
   briefing while the command center populates.
2. Tarik rambles an idea → `capture_thought` → note card appears mid-sentence.
3. "What's happening with AI in radio this week?" → `web_research`
   (AgentKey) → spoken summary, sources on dashboard.
4. Next day: "What was that podcast idea?" → `recall` → Morpheus answers.
   Loop closed.

**Latency expectations (honest):** simple replies ~1s; tool-using replies
2–4s, masked by spoken acknowledgments while tools run.

## Error handling

- Every tool returns a spoken-friendly failure message ("I couldn't reach
  your calendar — Google's auth expired; fix it from the control panel").
  Never silence, never a dead conversation.
- Control panel shows per-tool health and last error.
- Webhook routes validate inputs against each tool's schema; external data
  (Google, AgentKey) is treated as untrusted and validated before storage.

## Testing

- Unit tests for tool routes (Google/AgentKey mocked).
- **Text-mode harness:** same Claude + same tools, no voice — conversations
  testable cheaply and in CI.
- Voice E2E manual for v1.

## Phasing

- **Phase 1** — voice loop (ElevenLabs agent + Claude + Morpheus voice),
  dashboard shell, capture/remember/recall. No Google yet. You can talk to it.
- **Phase 2** — Google Calendar/Gmail tools + morning briefing + command
  center.
- **Phase 3** — AgentKey `web_research`, tool registry + control panel,
  MCP adapter groundwork.
- Each phase ships something conversable. After planning, phases feed into
  Linear via `/linear-build:linear-build`.

## Research pass (before implementation planning)

Verify current specifics, not feasibility:
- ElevenLabs Agents: custom-LLM (Claude) configuration, webhook tool calling,
  signature verification, React SDK APIs, pricing.
- Convex vector search API and embedding generation options.
- AgentKey integration mechanics (API shape, credit costs).
- Google OAuth scopes for read Calendar/Gmail + draft replies.

## Future enhancements (explicitly not v1)

- **Humalike** (humalike.ai) — behavioral layer for the personality:
  theory-of-mind and social-memory APIs could deepen Morpheus's
  humanlike feel; strongest fit if Morpheus ever joins multi-person
  contexts (Slack, meetings). $20 free tier; evaluate after thin slice.
- Voice output of proactive alerts; phone/PWA polish; thin Mac companion
  with global hotkey; self-hosted voice pipeline (LiveKit) if platform
  limits are hit; draft-and-send email actions (write scopes).
