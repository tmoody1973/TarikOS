# Tarik OS — Viewport (Agent-Controllable Browser Panel)

**Date:** 2026-08-07
**Status:** Approved in brainstorming
**Linear:** MOO-485 (build after MOO-483)

## What this is

A slide-in browser panel ("the Viewport") backed by a real hosted browser
session that both Zola and Tarik can drive. Zola executes browsing tasks by
voice ("go dig into X") through an AI automation loop while Tarik watches the
live session in the panel; Tarik can take over at any moment just by
interacting with the frame, or open a blank session and browse himself.
Findings become a brief document.

## Decisions made

| Decision | Choice |
|---|---|
| Vendor | **Browserbase** (session infra, embeddable interactive live view, replays) + **Stagehand** (TS agent loop: act/extract/observe on the Anthropic key) |
| browser-use | Rejected — Python (separate service to host), no embeddable viewer |
| Primary jobs (both) | Watch Zola work AND Tarik-driven browsing with Zola assist — one shared session surface serves both |
| Surface | Slide-in panel (ReaderPane pattern, wider), openable anywhere; no dedicated page in v1 |
| Entry points | Voice tool `browse {task}` (Zola drives) and a rail button (blank session, Tarik drives) |
| Findings | Written as a **brief** via the existing MOO-482 engine mutations; replay link included; `get_brief` answers "what did you find" |
| Takeover | Not a built feature — Browserbase live view iframes are natively interactive |
| Credentials | Zola NEVER enters credentials in v1; login walls flip status to `needs_takeover` |
| Concurrency | One session at a time |

## Architecture

```
voice: browse{task} ──▶ /api/tools/browse ──▶ create Browserbase session
                                             write browserSessions row
                                             fire /api/browser/run (Stagehand)
manual: rail button ──▶ identity-gated action ─▶ blank session

Panel (slide-in) ◀── live query browserSessions ── status/liveViewUrl
   └─ iframe = Browserbase live view (interactive → takeover for free)

/api/browser/run (Vercel fluid compute, long maxDuration)
   └─ Stagehand loop: act/observe/extract per task
      progress + status → Convex mutations
      findings → createOrResetBrief / appendSection / finishBrief
```

- **`browserSessions` table (Convex):** `status`
  (`idle | running | needs_takeover | done | error`), `task`, `liveViewUrl`,
  `replayUrl`, `briefId?`, timestamps. Panel is a live query on the latest
  row.
- **Runner placement:** Vercel route, not Convex — keeps playwright-core out
  of the Convex bundle; fluid compute covers long tasks. Fire-and-forget from
  the tool route so the voice reply is instant ("On it — watch the
  viewport").
- **Tool registry:** `browse` auto-registers like every other tool; the
  control-panel toggle and `toolGate` apply.

## Error handling

- Session create fails → spoken error, no dead panel.
- Agent stuck / login wall → `needs_takeover`; panel banner; Zola says
  "take the wheel."
- Task timeout → brief gets an error section; `replayUrl` always saved so
  the run is inspectable after the fact.
- END SESSION button kills the Browserbase session; closing the panel does
  not.

## Cost

Browserbase free tier (1 concurrent browser, limited hours) proves the
feature; daily use needs their paid tier (verify current pricing at build
time) plus Stagehand LLM tokens on the Anthropic key.

## Testing

- Unit: task-findings → brief-section mapping.
- Real-data verification: voice "go research X on the live web" → panel
  slides in, session visibly works, brief appears with sources + replay
  link; blank manual session; mid-task takeover; login wall →
  needs_takeover banner.

## Explicitly not in v1

- Zola entering credentials or completing logins/purchases
- Persistent profiles/cookies/sessions
- Multiple concurrent sessions
- Dedicated /browser page (panel may be promoted later)
- browser-use / Python sidecar
