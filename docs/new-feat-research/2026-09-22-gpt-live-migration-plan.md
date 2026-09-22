# Moving Zola's voice from ElevenLabs to OpenAI GPT-Live

**Research and migration plan · 2026-09-22 · Tarik OS**
**Status:** Proposed. Nothing built yet. This document is the plan Tarik asked for before any code moves.

---

## The one-paragraph version

GPT-Live is OpenAI's new voice model. It splits a voice assistant into two halves that run
at the same time: a **voice model** that listens and talks (full duplex, meaning it can hear
you while it is speaking), and a **backend model** that thinks and picks tools. You pay
$0.05 per minute for the voice half, plus normal token prices for the backend half. Zola's
52 webhook tools survive the move almost unchanged. What changes is who calls them: today
ElevenLabs calls Zola's tool routes for us; after the move, our own browser code receives
each tool request and forwards it to the same routes. Phone calls keep working for inbound
via Telnyx. Outbound calling (the `call_tarik` tool) is the one real gap and needs a spike.

The recommended path is four phases behind a switch, running both providers side by side
until GPT-Live wins on the eval and by ear. Nothing is deleted until the end.

---

## What Zola looks like today

Everything below was read from the repo on 2026-09-22.

| Piece | Where it lives | How it works today |
|---|---|---|
| Agent definition | `scripts/provision-agent.ts` (1,578 lines) | A script pushes the persona, 52 webhook tools, one client tool, one system tool, and the voice to ElevenLabs. Claude Sonnet 5 is the brain inside ElevenLabs. |
| Tool execution | `src/app/api/tools/[tool]/route.ts` (2,677 lines, 61 cases) | ElevenLabs POSTs to `/api/tools/<name>` with a shared secret header. The route checks the secret, checks the enable toggle in Convex, runs the tool, marks it healthy, returns `{ ok, message, data }`. |
| Browser client | `src/components/VoiceDock.tsx`, `src/app/talk/page.tsx`, `src/components/AppShell.tsx` | `@elevenlabs/react` handles the mic, the WebRTC connection, and the events. The orb reads volume from the SDK. |
| Session start | `src/app/api/voice/token/route.ts` | Clerk-gated route asks ElevenLabs for a WebRTC token. |
| Transcripts | `convex/transcripts.ts` | The browser appends each turn and each tool call to a `transcripts` table as they happen. |
| Post-call tracing | `src/app/api/elevenlabs/post-call/route.ts` → `src/lib/phoenixMapper.ts` → Phoenix | ElevenLabs sends a signed webhook after each call. We turn it into observability spans. |
| Wake word | `src/components/useWakeWord.ts` | Runs in the browser with `openwakeword-web`. Calls `engage()` when it hears "hey Zola". Independent of the voice provider. |
| Outbound calls | `call_tarik` case in the tools route | POSTs to ElevenLabs' SIP outbound endpoint, which dials Tarik's phone with the agent on the line. |
| Inbound calls | Configured on the platforms, no repo code | A Telnyx number's SIP trunk points at the ElevenLabs agent. |
| Evals | `evals/replay.py`, `evals/export_tools.ts`, `evals/labels.csv` (125 rows) | Sends the persona plus tool list to Claude directly and scores which tool it picks. Best run: 0.738 accuracy. Results go to Phoenix. |
| Text channels | `src/app/api/telegram/inbound/route.ts`, `src/lib/textTools.ts` | Telegram talks to Claude directly and calls the same tool routes. Not touched by this migration. |

Two facts that shape the plan: the tools route is already called by four other things
(Telegram, workflows, reminders, contacts cron) with the same secret, so it is a stable
seam. And the eval harness already runs against a bare model, not the ElevenLabs loop, so
it re-points cleanly.

---

## What GPT-Live actually is

Read from OpenAI's docs on 2026-09-22 (links at the end).

**Two halves.** GPT-Live (`gpt-live-1`) only handles the spoken conversation. When it
decides a request needs real work, it *delegates* to a backend. Two ways to run that backend:

| Mode | Who runs the backend | Where tools execute | Fit for Zola |
|---|---|---|---|
| **Responses delegation** | OpenAI runs a Responses model you name (they suggest `gpt-5.6-terra`, or `gpt-5.6-luna` for cost). It gets the conversation context and picks tools. | **Your app still runs every custom function** and sends the result back. | Matches what Tarik asked for: OpenAI does the tool calling. Recommended. |
| **Client delegation** | Your own code. GPT-Live only sends a "please do something" event with an ID and a timestamp. You rebuild the request from the transcript. | Your app, entirely. | Would let Zola keep Claude as the brain. More work, and not what was asked. Keep as the escape hatch. |

The mode is fixed when a session is created. Switching means a new session.

**How a tool call flows in Responses delegation.**
1. GPT-Live decides to delegate. The backend model picks a function.
2. Your app receives a `response.event` envelope. Inside it, a `response.output_item.done`
   event carries `call_id`, `name`, and `arguments`.
3. Your app runs the function and sends back `response.item.create` with a
   `function_call_output` for that `call_id`.
4. Your app sends `response.create` to let the backend continue.
5. GPT-Live speaks the result, in its own words, while the user may already be talking again.

**Three ways to feed the voice model mid-conversation**, each a plain string of at most
500 tokens: `session.commentary.append` (say this aloud), `session.thinking.append` (know
this, do not say it), `session.instructions.append` (behave differently from now on, can
interrupt speech).

**Connections.**
- **WebRTC** for the browser. The browser makes an SDP offer (the connection handshake),
  our server POSTs it to `/v1/live/sessions` with the API key, and returns the answer. No
  ephemeral token step; the server does the handshake. Events ride a data channel named
  `oai-events`.
- **WebSocket** for server-owned audio. Not needed for the browser path.
- **SIP** for phone. Telnyx has an official GPT-Live guide. Inbound only.
- **Sideband** is a second WebSocket from your server that attaches to a running session
  to receive events and run private tools. Optional for the browser path: the docs say the
  browser can forward function-call events to an authenticated backend instead.

**Money and limits, from the model page.**
- $0.05 per minute of session time, billed per second. Idle time counts. Muting does not stop billing. Creating a WebRTC session bills 15 seconds up front, credited back.
- Backend model tokens and web search are billed separately at normal rates.
- Rate limit is concurrent sessions: 25 at tier 1, up to 500 at tier 5. Zola has one user.
- Context window 128k tokens. GPT-Live summarizes old history itself. Instructions up to 16,384 tokens. Startup history up to 128 messages or 8,192 tokens.
- There is a maximum session duration (close reason `expired`). The number is not published. Plan for an idle-close.

**What GPT-Live does not have.**
- No turn-detection settings. You stream audio continuously and it decides when to speak. The VAD guide (server VAD, semantic VAD, `eagerness`) applies only to the older Realtime API; every example in it sets `type: "realtime"`. If GPT-Live's turn-taking ever needs tuning, the lever is the prompt's interruption and backchannel policy, not a config field.
- No event that says "I finished speaking". You watch your own audio player.
- No MCP tool type inside the hosted backend. Only `function` and `web_search`. Zola does not use MCP in the voice path, so this does not matter today.
- No voice cloning of an existing voice. Twenty-two built-in voices in the SDK (the docs page describes twelve of them by accent) plus "approved custom voices" made from your own recording through an approval process.
- No post-call webhook. You build the post-call record from the events you already receive.
- `@openai/agents-realtime` (the high-level SDK) does not support GPT-Live yet. The plain `openai` package does: `client.live.create(...)`, plus a sideband client. Version 7.21.0 shipped 2026-09-22. The repo has no `openai` package installed today.

---

## The architecture we would build

```
Browser (VoiceDock / talk page)
  │  mic + speaker on WebRTC media tracks        ──────────────────────►  OpenAI GPT-Live
  │  JSON events on data channel "oai-events"    ◄──────────────────────  (voice, gpt-live-1)
  │                                                                          │ delegates
  │  on function call:                                                       ▼
  │    POST /api/voice/tool-call  {call_id, name, arguments}          Responses backend
  │         │ (Clerk-gated, Vercel)                                    (gpt-5.6-terra)
  │         └─► fetch /api/tools/<name>  with x-morpheus-secret        picks the tool
  │                (existing route, unchanged: gate, health, tracing)
  │    ◄── {ok, message, data}
  │  send response.item.create + response.create back on data channel
  │
  │  transcript deltas ──► convex transcripts.appendTurn (as today)
  │  session.closed    ──► POST /api/voice/post-call ──► Phoenix spans (as today, new mapper)
```

**Why the browser forwards tool calls instead of a server sideband.** The sideband is a
WebSocket our server would have to hold open for the whole conversation. Vercel Functions
now support WebSockets, but a connection dies when the function hits its time limit: 300
seconds by default, 800 on Pro, 1,800 in beta. A twenty-minute chat with Zola would drop
its tool channel three times. Browser forwarding needs only short HTTP requests, which is
what Vercel is built for. The secret never leaves the server: the browser hits a
Clerk-gated route, and that route calls the tools route with the secret, the same pattern
the Telegram route uses today.

The cost of this choice: if Tarik closes the tab mid-tool, the tool result is lost. For a
personal assistant that is acceptable. The sideband becomes the phase-3 upgrade, hosted on
the Hetzner box where a long-lived process is normal, and it is required for phone calls
anyway.

**New routes (three small ones).**
- `POST /api/voice/session` replaces `/api/voice/token`. Takes the SDP offer, calls `client.live.create` with the session config, returns the answer. Clerk-gated.
- `POST /api/voice/tool-call` takes `{ call_id, name, arguments }`, forwards to `/api/tools/<name>` with the secret, returns the result. Clerk-gated.
- `POST /api/voice/post-call` takes the event timeline the browser collected, builds Phoenix spans. Clerk-gated. Replaces the ElevenLabs post-call webhook.

**Session config moves into code.** `scripts/provision-agent.ts` stops being a script you
run and becomes `src/lib/voice/liveSession.ts`, exporting the voice instructions, the
backend instructions, and the tool list in Responses function format. The config is sent
fresh on every session, so there is no provisioning step and no agent ID to keep in sync.

**The add-a-tool pattern in AGENTS.md gets shorter.** Step 1 (route case) is unchanged.
Step 2 becomes "add the function definition to `TOOLS` in `liveSession.ts`", with no
provision command. Step 3 (auto-registration on first healthy call) is unchanged.

**The 52 webhook tools convert mechanically.** Each ElevenLabs definition has `name`,
`description`, and `apiSchema.requestBodySchema`. A Responses function is `{ type:
"function", name, description, parameters }` where `parameters` is that same body schema.
`export_tools.ts` already reads exactly those fields for the evals. The things that do not
carry over are ElevenLabs-only knobs: `preToolSpeech`, `toolCallSound`, and per-tool
timeouts. GPT-Live handles "say something while working" through its prompt and through
`session.commentary.append`.

**Two special tools.**
- `navigate_ui` is a client tool today. In GPT-Live it is just another function the backend can pick. The browser sees the name, calls `router.push`, and returns `{ ok: true }` without touching the server.
- `end_call` is an ElevenLabs system tool today. It becomes a function the browser handles by sending `session.close` and waiting for `session.closed`.

**The prompt splits in two.** OpenAI is explicit: do not paste one prompt into both halves.
- **Voice instructions** (`session.instructions`): who Zola is, how she sounds, the backchannel policy, the interruption policy, and a delegation policy listing what the backend can do (memory, calendar, mail, tasks, documents, habits, reminders, research, contacts, telos). Tight replies, no lists. The `[sighs]`, `[laughs]`, `[whispers]` tags are ElevenLabs v3 syntax and come out; GPT-Live is prompted in plain words for tone.
- **Backend instructions** (`delegation.responses.instructions`): the four "never" rules, the thought/task/reminder distinctions, the two-mailbox rule, the confirmation rituals for `create_plane_project` and `propose_studio_edit`, the multi-call sequences, and the habit guardrails. This is where tool judgement lives now.
- **Standing context** (telos plus the 30 latest memories) goes into the backend instructions in full, and a two-line summary into the voice instructions. Today it is a template variable; tomorrow it is a string built at session start from the same Convex query.

**Transcripts and the orb.** Transcript text arrives as fragments with timestamps
(`session.input_transcript.delta`, `session.output_transcript.delta`). The browser groups
fragments into turns and appends them to Convex exactly as `onMessage` does today. The orb
loses the SDK's `getInputVolume` and `getOutputVolume`; it gets a WebAudio analyser on the
mic stream and one on the remote audio track. `LiveWaveform.tsx` already opens a mic stream
for the waveform, so the two can share one. "Is speaking" is derived from output level,
because there is no end-of-response event.

**Wake word is untouched.** It calls `engage()`, and `engage()` changes inside. The same
rule holds: the detector releases the mic while a session is live.

---

## Phone calls

**Inbound (works, more setup than code).** Telnyx publishes a GPT-Live guide. The Telnyx
number gets an FQDN SIP connection to `sip.api.openai.com` on port 5061 with TLS and SRTP
mandatory. OpenAI sends a signed `live.transport.incoming` webhook to a new route
`/api/openai/webhook`, which accepts the call with the same session config. For tools on a
phone call there is no browser to forward them, so a **sideband is required**. That
sideband is a long-lived WebSocket, so it lives on the Hetzner box as a small Node service,
not on Vercel. Audio never touches our servers: caller, Telnyx, and OpenAI exchange it
directly.

**Outbound (`call_tarik`) is a gap.** OpenAI's SIP docs say creating an outbound call
through session creation is not supported. Telnyx's guide is inbound-only and says so.
Telnyx's partner listing claims outbound is possible with their Voice API, which suggests
dialing Tarik from Telnyx and bridging the answered leg into the OpenAI SIP trunk. That is
a spike, not a plan line. Two honest options:

1. **Keep ElevenLabs for `call_tarik` only** during the transition. One tool, one env var set, one SDK left installed. Low effort, slightly ugly.
2. **Downgrade `call_tarik`** to a Telnyx text-to-speech call that reads the message and hangs up. Loses the two-way agent on the phone.

Recommendation: option 1 until the Telnyx bridge spike is done in phase 3.

---

## Evals

The current harness is a better fit for GPT-Live than it was for ElevenLabs. `replay.py`
sends the persona and tools to a bare model and scores tool selection. Under Responses
delegation the backend *is* a bare Responses model with those tools, so the harness becomes
a faithful replica instead of an approximation. Changes:

- `export_tools.ts` emits Responses function format (it already reads the right fields).
- `replay.py` calls the OpenAI Responses API with `gpt-5.6-terra` instead of Anthropic, using the backend instructions, not the voice ones.
- `pull_utterances.py` loses its ElevenLabs source. New utterances come from Convex `transcripts`.
- The 125-row `labels.csv` is reusable as-is; its `conversation_id` column becomes cosmetic.
- Later, OpenAI's voice-agent evaluation cookbook has a crawl/walk/run harness built for GPT-Live (synthetic audio, real recordings, simulated caller) that measures response latency, silence during delegation, and delegation accuracy. That is the phase-4 upgrade.

Baseline to beat: 0.738 tool-selection accuracy on 107 utterances.

---

## What we give up

- **The Zola voice.** It is a designed ElevenLabs voice. GPT-Live cannot clone it. Tarik picks from 22 built-in voices by ear (defaults to `marin`; `gleam`, `delta`, and `quartz` are the feminine English options) or records a custom voice and goes through OpenAI's approval.
- **The expressive tags.** `[sighs]` and friends are gone. Tone comes from the prompt.
- **Platform-run webhooks.** ElevenLabs called our tools and retried for us. Now our browser code owns that loop, including the lost-result case when a tab closes.
- **The post-call webhook.** We assemble the call record ourselves from events we already receive.
- **Claude as the voice brain.** Under Responses delegation the tool-picker is an OpenAI model. Every carefully tuned "never" rule gets re-tested. Client delegation would keep Claude, at the cost of building the delegation loop ourselves.
- **Outbound calling**, until the spike lands.
- **Unknowns:** the maximum session length, and independent latency numbers for GPT-Live versus ElevenLabs. Vendor blogs claim 300–500 ms to first audio for OpenAI's voice stack versus 500–800 ms for ElevenLabs, but those are not independent benchmarks.

---

## Phases

Each phase ships to production behind a switch, because that is how this project works.
The switch is an env var `VOICE_PROVIDER` read by `AppShell`, defaulting to `elevenlabs`,
plus a `?voice=live` query override so Tarik can test in prod without flipping everyone.

**Phase 0: spike (one page, no tools).**
Add `openai@^7.21`. Add `/api/voice/session`. Add a `/talk-live` page with a hand-rolled
WebRTC client: mic, speaker, transcript deltas on screen. Voice instructions only, backend
with `web_search` only, exactly like OpenAI's quickstart. Goal: hear Zola's new voice and
pick one. ElevenLabs untouched. Success: a two-minute conversation, session closes cleanly,
`usage.seconds` matches the clock.

**Phase 1: tools and memory.**
First step: lift the session lifecycle out of `talk-live/page.tsx` into a `useLiveSession`
hook under `src/lib/voice/` so tools, transcripts, and the orb are added once and phase 2
swaps VoiceDock onto it instead of rewriting. Then:
Convert `TOOLS` to Responses format in `liveSession.ts`. Add `/api/voice/tool-call`. Wire
the function-call loop in the browser. Split the prompt. Build standing context at session
start. Transcripts to Convex. `navigate_ui` and `end_call` as browser-handled functions.
Success: every tool in `labels.csv` fires through the new path at least once; the Convex
tools registry shows them healthy; a morning briefing works end to end.

**Phase 1 tool-wait rules** (from a note Tarik brought in on 2026-09-22, checked against
the docs). GPT-Live keeps listening while a tool runs, so the goal is to make waits short
and never silent, not to paper over them.
- Tool results stay compact. The tools route already returns a spoken-ready `message`; keep sending that, never raw `data`, to the voice model.
- Per-tool timeouts move from the ElevenLabs config into the tool-call forwarder, with a spoken fallback on timeout instead of dead air.
- Every forwarded call carries the delegation ID and a task revision. A correction mid-lookup aborts the old request and discards its late result.
- Start with `parallel_tool_calls: false`, as the migration guide advises, then allow parallel calls for independent lookups once the loop is stable.
- The voice prompt gets acknowledgment rules: no filler for fast lookups, one specific acknowledgment for slow ones, never narrate internal steps, never claim completion before a result arrives. Progress on long tasks goes through `session.commentary.append`.
- Measure the whole path per turn: end of speech, delegation received, tool start and end, result submitted, first audio played. Compare median and 95th percentile, per the voice-agents guide.
- Two things in that note do not apply to GPT-Live: the "ephemeral credentials then RealtimeSession" flow is the older Realtime API, and its 0.7s and 2s thresholds are the author's heuristics, not OpenAI numbers.

**Phase 2: cutover behind the switch.**
Replace `ConversationProvider` and `useConversation` with a `LiveProvider` and
`useLiveSession` hook. Orb on WebAudio analysers. Post-call spans via `/api/voice/post-call`.
Update `voiceDockStates.test.ts` and `talkRoute.test.ts`. Re-point `replay.py`; run the
eval; compare to 0.738. Flip `VOICE_PROVIDER=openai` in prod when the eval and Tarik's ear
both agree. Rollback is flipping it back.

**Phase 3: phone.**
Telnyx FQDN SIP connection to OpenAI. `/api/openai/webhook` route with signature check.
Sideband service on Hetzner (Node, `openai` sideband client, same tool-forwarding code
lifted into a shared module). Spike the Telnyx outbound bridge for `call_tarik`.
Success: inbound call answered by Zola with tools; `call_tarik` either bridged or
consciously kept on ElevenLabs.

**Phase 4: remove ElevenLabs.**
Delete `@elevenlabs/*` packages, `provision-agent.ts`, `/api/voice/token`,
`/api/elevenlabs/post-call`, and the three `ELEVENLABS_*` env vars from Vercel. Update
AGENTS.md, README, and the eval docs. Optionally adopt the cookbook crawl/walk/run harness.

---

## Open questions for Tarik

1. **Which voice.** Needs ears, not research. Phase 0 exists to answer this.
2. **Claude or OpenAI as the brain.** The request said OpenAI for tool calling, so this plan uses Responses delegation. Client delegation keeps Claude and the prompt-caching work, at the cost of building the delegation loop. Say the word and the plan changes at phase 1.
3. **Backend model.** Start with `gpt-5.6-terra` as OpenAI suggests; try `gpt-5.6-luna` if the eval holds and the bill matters.
4. **`call_tarik` during transition.** Keep on ElevenLabs, or accept a text-to-speech downgrade.
5. **Does the Hetzner box host the phone sideband,** or does inbound calling wait.

---

## Sources

All fetched and read on 2026-09-22. The announcement post itself returned 403 to every fetch, so nothing here is drawn from it.

- Getting started with GPT-Live: https://developers.openai.com/api/docs/guides/live
- Voice agents (architecture comparison): https://developers.openai.com/api/docs/guides/voice-agents
- Migrate to GPT-Live: https://developers.openai.com/api/docs/guides/live-migration
- Delegation and tools: https://developers.openai.com/api/docs/guides/live-delegation
- Managing GPT-Live sessions: https://developers.openai.com/api/docs/guides/live-conversations
- Prompting GPT-Live: https://developers.openai.com/api/docs/guides/live-prompting
- Server-side controls (sideband): https://developers.openai.com/api/docs/guides/voice-server-controls
- WebRTC: https://developers.openai.com/api/docs/guides/voice-webrtc
- Telephony and SIP: https://developers.openai.com/api/docs/guides/voice-sip
- Cost optimization: https://developers.openai.com/api/docs/guides/voice-latency-cost
- Model page and pricing: https://developers.openai.com/api/docs/models/gpt-live-1
- Partner integrations: https://developers.openai.com/api/docs/guides/live-partner-integrations
- Telnyx GPT-Live SIP guide: https://developers.telnyx.com/docs/voice/sip-trunking/gpt-live-configuration-guide
- Voice agent evaluation cookbook: https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation
- Vercel Functions WebSockets: https://vercel.com/docs/functions/websockets
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- `openai` npm 7.21.0 (contains `resources/live`): https://registry.npmjs.org/openai/7.21.0
- Voice activity detection (Realtime API only, read to confirm it does not apply): https://developers.openai.com/api/docs/guides/realtime-vad
