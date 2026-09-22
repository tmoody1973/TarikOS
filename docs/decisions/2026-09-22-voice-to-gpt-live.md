# Zola's voice moves to OpenAI GPT-Live

**Decision record · 2026-09-22 · Tarik OS**
**Status:** Proposed. Plan written, nothing built. See `docs/new-feat-research/2026-09-22-gpt-live-migration-plan.md`.

---

## Decision

Replace ElevenLabs Conversational AI with OpenAI GPT-Live as Zola's voice layer, using
Responses delegation so an OpenAI model picks the tools, with tool execution forwarded from
the browser to the existing tool routes, rolled out in four phases behind an environment switch.

## Why this came up

Tarik asked for it, pointing at OpenAI's GPT-Live launch. Underneath the ask are three real
pressures. ElevenLabs owns the whole voice loop, so what it caches, how it retries tools, and
what the call cost are invisible from the repo. Its turn-taking is turn-based, so Zola cannot
be interrupted mid-sentence and keep working. And the voice half and the brain half are
bundled, so the brain cannot be swapped or evaluated on its own.

GPT-Live is full duplex (it listens while speaking) and separates the voice model from the
backend model that reasons and picks tools. That separation is the thing worth having.

What was at stake: 52 webhook tools, a wake word, an orb, a phone number, an eval harness,
and a persona tuned over weeks. A bad migration breaks all of them at once.

## Options

1. **Responses delegation (chosen).** OpenAI hosts the backend model (`gpt-5.6-terra`).
   Our browser code receives each function call and forwards it to the existing tool routes.
   Cost: the tool-picking brain changes from Claude to an OpenAI model, so every guardrail
   gets re-tested. The browser owns the tool loop, so a closed tab loses an in-flight result.

2. **Client delegation.** Keep Claude as the brain. GPT-Live sends a bare "do something"
   event; we rebuild the request from transcripts and run our own agent loop. Cost: we build
   and operate the delegation loop, context assembly, and result routing ourselves. More code
   before the first tool works.

3. **Stay on ElevenLabs.** Zero migration cost. Keeps the bundled brain, turn-based
   conversation, and the opaque cost and caching story.

A fourth option, running a server-side sideband on Vercel for tools, was rejected before it
made the list: Vercel cuts a WebSocket at 300 to 1,800 seconds, so it would drop mid-call.

## What we chose and why

Option 1. Tarik asked for OpenAI to do the tool calling, and Responses delegation is the
mode built for that. The 52 tool definitions convert mechanically because both sides use
JSON schema. Browser forwarding keeps the whole thing on Vercel with short HTTP calls and
keeps the shared secret on the server, the same shape the Telegram channel already uses.

The call was Tarik's on the direction and Claude's on the shape. Option 2 stays open at
phase 1 if the re-tested guardrails come back worse than Claude's.

## What we gave up

- The designed Zola voice. GPT-Live cannot clone it; Tarik picks a new one by ear.
- The expressive audio tags in the persona.
- ElevenLabs running and retrying our webhooks for us.
- The post-call webhook; we assemble call records from events ourselves.
- Claude as the tool-picker, and the prompt-caching savings tied to it.
- Outbound calling (`call_tarik`) until a Telnyx bridge spike lands. OpenAI does not create outbound SIP sessions.
- Certainty on two numbers: maximum session length is unpublished, and latency claims are vendor blogs.

## How we'll know if this was right

- Tool-selection accuracy on the existing 107-utterance eval is at or above the 0.738 baseline within phase 2.
- Tarik interrupts Zola mid-sentence and she stops, listens, and the tool she was running still finishes.
- A ten-minute session costs within 20% of what the model page predicts: about $0.50 voice plus backend tokens, read from `session.closed` usage.
- An inbound Telnyx call reaches Zola with tools working by the end of phase 3.
- No ElevenLabs package or env var remains after phase 4.

## What actually happened

_(Tarik fills this in.)_
