# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two confirmed audiences, weighted equally:

1. **Tarik** — the primary daily user. Runs his real life through it: morning brief, mail triage across multiple Google accounts, calendar, long-term goals (telos), journal, research. Interacts voice-first (speaking to Zola) with the dashboard as the live visual companion.
2. **Forkers** — developers who clone the public repo (tmoody1973/TarikOS, MIT) to stand up their own instance on their own accounts. Docs, onboarding, and UI should feel like a polished open-source product, not an internal tool. Single-user by design: each fork serves one person; no multi-tenant support.

## Product Purpose

A personal AI operating system you talk to. Zola — the realtime speech-to-speech assistant at its center — reads mail, works the calendar, runs research, keeps a journal, tracks long-term goals, drives a real browser, and delivers a morning brief. You speak; she acts; a live dashboard shows what happened.

Success is all three, together:
- **Daily reliance** — the owner actually runs their day through it, replacing scattered apps.
- **Trustworthy delegation** — Zola safely handles real actions (mail drafts, calendar, browsing) behind guardrails the owner never has to doubt.
- **Learning platform** — a living, readable reference for building agentic systems; the repeatable tool pattern is part of the product.

## Positioning

A voice-first personal OS where every capability is one webhook case away: add a `case` to the tool route, provision the agent, and the tool self-registers in the dashboard with health status and a kill switch. Competing assistants are either hosted products you can't inspect or frameworks you can't live in; this is one person's real daily driver published as a working, forkable reference — guardrails enforced by tests, not policy prose.

## Operating Context

- Owner speaks to Zola through a browser voice session (ElevenLabs Agents, WebRTC); the dashboard updates live via Convex subscriptions while she talks.
- Surfaces: home HUD, /briefs (morning brief + findings), /mail (mail center), /telos (goals), /brain (memory/journal), /conversations, /control (tool registry, feeds).
- Scheduled rhythms: nightly memory consolidation, 3am journal→goal mining, morning brief, Sunday weekly review (Convex crons).
- Gmail + Google Calendar via Composio (holds OAuth, multi-account). Claude does drafting/reasoning server-side. Voyage AI embeddings power semantic recall of past conversations.
- Viewport: Zola can drive a hosted Browserbase session with a live view panel; sessions are always credential-free.
- **Committed, not yet built** (MOO-497/498/499): Zola reachable beyond the browser — SMS and real phone calls via a Telnyx number (SIP into the same ElevenLabs agent; proactive texts/calls to the owner; outbound to others only behind a spoken-confirm ritual), backed by a contacts store synced one-way from Google Contacts and Apple/iCloud Contacts so "text Marcus" resolves to a real number.

## Capabilities and Constraints

- Every capability is a webhook tool: `POST /api/tools/<tool_name>`, shared-secret auth, returns a sentence Zola can speak. Pattern documented in AGENTS.md; tools self-register in Convex and appear in /control with enable/disable, health dot, last error.
- **Structural guardrails (enforced by tests, must be preserved):**
  - Zola can draft email; only a human can send it. No send path exists on the agent's tool surface.
  - Calendar writes go through a spoken confirm ritual before committing.
  - The browser agent never types a password. Sessions are signed out by default; they carry the owner's saved logins (a Browserbase Context he signs into by hand) only when he asks for them in that request, and no scheduled job can start a browser session at all.
- Stack: Next.js 16 (App Router), React 19, Tailwind CSS 4, Convex (state/realtime/crons/vector), Clerk (auth on every page and non-webhook route), ElevenLabs Agents, Anthropic SDK, Composio, Browserbase + Stagehand, TipTap (compose), three.js (HUD flourishes). Vercel + Convex Cloud hosting.
- Terminology: "Zola" (assistant persona; formerly Morpheus — internal names like `MORPHEUS_TOOL_SECRET` persist in code), "telos" (long-term goals), "briefing cards", "Viewport" (browser panel), "tool" (agent webhook capability).
- **Zero analytics/telemetry, by design.** No usage tracking, no phone-home — a product fact, part of the trust story for a self-hosted personal OS. Future work must not add any without an explicit product decision.

## Brand Commitments

- **Zola** is the binding assistant name and persona (rename from Morpheus is deliberate; code internals may lag).
- **The LCARS / sci-fi HUD aesthetic is a binding identity commitment**, not incumbent accident — the dashboard's visual world stays in that family ("Iron Man HUD effect" is the stated experience goal for live updates).
- Product name: **Tarik OS** (repo published as TarikOS).

## Evidence on Hand

- Working production instance: full voice loop, mail center, telos, briefs, feeds, Viewport — deployed on Vercel + Convex Cloud.
- Design specs per build phase in `docs/superpowers/specs/` (morpheus-design, mail-center, phase2-workflows, telos, viewport-browser).
- Test suite (`tests/`) that enforces the guardrails, including failing if an email-send path appears on the agent tool surface.
- README with architecture diagram, env table, and fork/setup walkthrough.
- No testimonials, user counts, or benchmarks exist — do not fabricate any.

## Product Principles

1. **Voice acts, dashboard shows.** The conversation is the control surface; screens exist to reflect and extend what was said, live.
2. **Guardrails are structural.** Safety properties live in code and tests, never in persona instructions alone.
3. **One pattern for every capability.** New powers follow the webhook-tool pattern end to end; no bespoke integrations that bypass the registry.
4. **One person, fully served.** Depth for a single real life beats breadth for hypothetical users; multi-tenancy is a non-goal.
5. **Readable enough to fork.** Every subsystem should teach the pattern it implements — the repo is documentation.

## Accessibility & Inclusion

WCAG 2.2 AA is the standard (decided 2026-08-08): keyboard operability, visible focus, and AA contrast across all dashboard surfaces — including within the LCARS/HUD aesthetic, which must meet the bar rather than exempt itself from it. Existing surfaces have not yet been audited against it.
