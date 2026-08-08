# Tarik OS

A personal AI operating system you talk to. Zola — the voice assistant at its center — reads your mail, works your calendar, runs research, keeps a journal, tracks your long-term goals, and briefs you every morning. You speak; she acts; a live dashboard shows what happened.

This is a single-user system built for one person's real life, published as a working reference. Fork it and make it yours — it is not a hosted product and has no multi-tenant support.

## How it works, in plain English

1. **You talk.** The browser opens a realtime voice session with an [ElevenLabs Agent](https://elevenlabs.io/agents). Zola listens, responds with a voice, and decides when a request needs a real action.
2. **She calls a tool.** Every capability — "what's on my calendar", "draft a reply to that email", "run my research workflow" — is a webhook the agent calls: `POST /api/tools/<tool_name>` on this app, authenticated with a shared secret. The route does the actual work and returns a sentence for Zola to speak.
3. **The work happens server-side.** Tool routes talk to Gmail and Google Calendar through [Composio](https://composio.dev) (which holds the OAuth tokens), to Claude for writing and reasoning, and to [Convex](https://convex.dev) for state.
4. **The dashboard reacts live.** Convex is a realtime database: when a tool writes a briefing card, a journal entry, or a workflow result, every open page updates instantly — no refresh. The UI is a set of LCARS-styled panels: morning brief, mail center, calendar, telos (goals), journal, memory.
5. **Some things run on a clock.** Convex cron jobs run scheduled workflows: a nightly pass that consolidates the day's conversations into long-term memory, a 3am pass that mines journal entries for goal signals, a morning brief, and a Sunday weekly review.
6. **She remembers.** Conversations are stored in Convex, embedded with [Voyage AI](https://www.voyageai.com), and recalled semantically — so "what did I say about that station project last week?" works.

Three guardrails are structural, not polite requests:

- **Zola can draft email; only a human can send it.** The send endpoint exists solely behind the browser UI's Send button. The agent's tool surface has no send path — a test fails the suite if one ever appears.
- **Calendar writes confirm before they commit.** Event creation and edits go through a confirm ritual in conversation.
- **The browser agent never touches credentials.** Zola can drive a real browser (see Viewport below), but sessions are always bare — no stored logins exist — and login walls stop the agent and hand you the wheel. Also enforced by tests.

## Tech stack

| Layer | Technology |
|---|---|
| Web app | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4 |
| Voice | ElevenLabs Agents (realtime speech-to-speech), `@elevenlabs/react` |
| Reasoning / writing | Claude (Anthropic SDK, server-side) |
| State + realtime + crons | Convex |
| Auth | Clerk (protects every page and API route except the secret-gated tool webhooks) |
| Google access | Composio (holds Gmail + Calendar OAuth, multi-account) |
| Semantic memory | Voyage AI embeddings + Convex vector search |
| Rich text | TipTap (mail compose) |
| Browser automation | Browserbase (hosted sessions, interactive live view) + Stagehand (AI agent loop) |
| Email safety | linkedom server-side sanitizer + sandboxed iframes |
| 3D / HUD flourishes | three.js via react-three-fiber |
| Hosting | Vercel (app) + Convex Cloud (backend) |

## Architecture

```
                ┌─────────────────────────────┐
   voice        │  ElevenLabs Agent (Zola)    │
  ┌────────┐    │  listens · speaks · decides │
  │ Tarik  │◄──►└──────────────┬──────────────┘
  └───┬────┘                   │ webhook + shared secret
      │ browser                ▼
      │         ┌─────────────────────────────┐
      └────────►│  Next.js app (Vercel)       │
                │  /api/tools/<tool>  ← agent │
                │  /api/mail, /api/reader …   │
                │  pages: brief · mail · telos│
                └───────┬──────────┬──────────┘
                        │          │
              Composio  │          │  Convex (realtime DB,
              (Gmail,   │          │  workflows, crons,
              Calendar) │          │  vector memory)
                        ▼          ▼
                   Google APIs   Claude · Voyage
                                 Browserbase + Stagehand (Viewport browser)
```

The repeatable pattern, documented in [AGENTS.md](AGENTS.md): every new capability is (1) a `case` in `src/app/api/tools/[tool]/route.ts`, (2) a tool definition in `scripts/provision-agent.ts`, (3) nothing else — tools self-register in Convex on first use and appear in the dashboard control panel with health status and an enable/disable toggle.

## Project structure

```
src/app/            Pages: home HUD, /briefs, /mail, /telos, /brain, /control
src/app/api/tools/  The agent's tool webhook (one case per capability)
src/app/api/mail/   Browser-facing mail routes (Clerk-protected)
src/lib/            Server-side domain logic: google.ts, mail.ts, calendarLib.ts …
convex/             Schema, workflows, crons, memory consolidation, telos
scripts/            provision-agent.ts · connect-google.ts · import-telos.ts
tests/              node --test unit tests for the pure logic
docs/superpowers/   Design specs for each build phase
```

## Running it yourself

You are standing up your own instance wired to your own accounts. Nothing here talks to the author's data.

### Prerequisites

- Node.js 22+ and npm
- Accounts: [Convex](https://convex.dev), [Clerk](https://clerk.com), [ElevenLabs](https://elevenlabs.io) (Agents access), [Composio](https://composio.dev), [Anthropic](https://console.anthropic.com), [Voyage AI](https://voyageai.com) (optional, semantic memory), [Browserbase](https://browserbase.com) (optional, Viewport)

### Setup

```bash
git clone https://github.com/tmoody1973/TarikOS.git
cd TarikOS
npm install

# Convex: creates your deployment and writes CONVEX_* vars
npx convex dev

# Fill in the rest of .env.local (see table below)

# Connect a Google account through Composio (repeat per account)
node scripts/connect-google.ts work

# Create/update the ElevenLabs agent with the full tool surface
node scripts/provision-agent.ts

npm run dev
```

Sign in through Clerk, open the site, and start the voice session from the dock.

### Environment variables

Values live in `.env.local` (gitignored) and in Vercel/Convex env settings in production. Never commit them.

| Variable | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (drafting, workflows, consolidation) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | The provisioned agent's id (written by provision script) |
| `COMPOSIO_API_KEY` | Composio key holding your Google OAuth connections |
| `MORPHEUS_TOOL_SECRET` | Shared secret the agent sends with every tool webhook |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk auth |
| `NEXT_PUBLIC_CONVEX_URL` / `NEXT_PUBLIC_CONVEX_SITE_URL` / `CONVEX_DEPLOYMENT` | Convex deployment |
| `VOYAGE_API_KEY` | Voyage embeddings for semantic memory (optional) |
| `AGENTKEY_API_KEY` | Reserved for external agent access |
| `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` | Browserbase (Viewport browser sessions; optional) |
| `TOOL_BASE_URL` | Your deployment's tool webhook base, e.g. `https://<your-app>/api/tools` |

`MORPHEUS_TOOL_SECRET` must be set in both the Convex deployment (`npx convex env set`) and the app env, and is baked into the agent by the provision script.

### Tests and deploys

```bash
npm test              # node --test — pure-logic unit tests
npm run build         # production build (Turbopack)
npx convex deploy     # backend
vercel deploy --prod  # app
```

## Features

- **Morning brief** — a GOALS-led daily brief assembled by workflow: calendar, mail highlights, feeds, telos progress. Regenerates on demand by voice ("run my brief").
- **Mail center** (`/mail`) — read full Gmail threads in-app (server-sanitized, sandboxed), compose and reply with rich text, Gmail-native drafts, explicit send. Multi-account. Say *"draft a reply to the X email saying…"* and Zola writes it with thread context — it lands as a badged draft you edit and send yourself.
- **Viewport** — a slide-in panel showing a real hosted browser that Zola drives by voice ("go dig into X") while you watch; click into the frame to take over, or open a blank session and browse yourself. Findings become a brief with a session-replay link.
- **Feed manager** — add news sources by voice ("add The Verge to tech headlines") or by pasting a URL in the Control Panel; feeds are autodiscovered and validated before saving, with per-feed health dots.
- **Calendar by voice** — list, create, and move events with a confirm-before-write ritual.
- **Telos** (`/telos`) — long-term goals as data: voice capture, semantic recall, goal-aware briefs, Sunday weekly review.
- **Voice journaling** — journal entries by voice; a nightly pass mines them for goal signals.
- **Semantic memory** — conversations consolidated nightly and recalled by meaning, not keywords.
- **Research workflows** — scheduled or on-demand multi-step research (RSS + web search) rendered as briefing cards with an in-app reader.
- **Control panel** (`/control`) — every tool's health, last error, and an enable/disable toggle; disabled tools are blocked at the route.
- **Voice console** — mic waveform, live transcripts, and a tool-activity matrix so you can see Zola working.

## Design specs

Each phase shipped against a written spec in [`docs/superpowers/specs/`](docs/superpowers/specs/) — foundation, workflows and briefs, telos, mail center, viewport. They read as a build log of the decisions and their reasons.

## License

[MIT](LICENSE) — do what you like, attribution appreciated. The name "Tarik OS" refers to the author's personal instance; your fork will have your name on it anyway.
