# Tarik OS — Mail Center (in-app read, compose, Zola drafts)

**Date:** 2026-08-07
**Status:** Approved in brainstorming
**Linear:** MOO-492 (read foundation) → MOO-493 (compose + send) → MOO-494 (Zola drafts)

## What this is

Email becomes an in-app surface instead of a Gmail deep link: read full
threads inside Tarik OS, compose with Gmail-like rich text, and have Zola
draft mail by voice ("draft a reply to the WBEZ email saying…") that Tarik
reviews, edits, and sends. The structural guardrail: **Zola can draft; only
Tarik can send** — no send path exists in her tool surface.

## Decisions made

| Decision | Choice |
|---|---|
| Surface | **`/mail` destination page** (thread list + reading pane, LCARS rebuild of the shadcn Mail three-pane shape); compose is a wide SlideOver. Pattern language: compose-capable surfaces are destinations |
| Drafts | **Gmail-native** — Zola and the editor write real Gmail drafts; Send = `GMAIL_SEND_DRAFT` (atomic). No Convex drafts table. Composio has no draft-update action, so edit = delete + recreate (invisible to Tarik) |
| Editor | TipTap (`@tiptap/react` + starter-kit + link) → clean HTML. Gmail-ish toolbar: bold/italic/lists/links |
| HTML safety | Server-side sanitize with **linkedom** (already in-house): strip `<script>`/`<style>` where hostile, all `on*` attributes, forms; render in a `sandbox` iframe |
| Data path | `src/lib/mail.ts` (Composio wrappers, sibling of google.ts) → `/api/mail/*` Clerk-protected routes → page. Composio key server-only |
| Accounts | Both connected Gmail accounts; work default, account chips to switch (mirrors calendar) |
| AI drafting | Server-side Claude direct (consolidation pattern) — not Vercel AI SDK |
| Skipped from research | TanStack Query/Zustand (Convex-live + fetch is house style), emailcn (wrong problem), shadcn components (LCARS is locked — layout reference only) |

## Composio actions (verified to exist 2026-08-07)

`GMAIL_FETCH_EMAILS` (list), `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` (thread),
`GMAIL_CREATE_EMAIL_DRAFT`, `GMAIL_LIST_DRAFTS`, `GMAIL_DELETE_DRAFT`,
`GMAIL_SEND_DRAFT`, `GMAIL_SEND_EMAIL`, `GMAIL_REPLY_TO_THREAD`.
Calendar lesson applies: **schema docs are hints — validate each with one
real call early in the build.** Verify at MOO-493: whether
`GMAIL_CREATE_EMAIL_DRAFT` accepts a thread id (draft-first replies); if
not, replies fall back to `GMAIL_REPLY_TO_THREAD` fired only on Tarik's
explicit Send click.

## Architecture

```
/mail page (LCARS 3-pane: accounts+list | reading pane; compose SlideOver)
   └─ fetch → /api/mail/* (Clerk-gated browser routes)
                └─ src/lib/mail.ts → Composio Gmail actions
voice: draft_email ─▶ /api/tools/draft_email (existing tool route, secret-gated)
                        └─ Claude writes body (thread context for replies)
                        └─ GMAIL_CREATE_EMAIL_DRAFT  ← never sends
```

Routes: `GET /api/mail/threads?account&q` · `GET /api/mail/threads/:id` ·
`POST /api/mail/drafts` (create/replace) · `POST /api/mail/drafts/:id/send` ·
`POST /api/mail/reply` (fallback path). All identity-gated by the existing
Clerk proxy (only /api/tools is exempt).

## Issue scope

1. **MOO-492 — Mail read foundation:** `mail.ts` list/thread + sanitizer,
   threads/thread routes, `/mail` page (list, reading pane, account chips,
   sanitized iframe), NavRail MAIL entry, `navigate_ui` learns mail.
2. **MOO-493 — Compose + send:** TipTap compose SlideOver (new + reply),
   draft-first save to Gmail, DRAFTS filter, Send via `GMAIL_SEND_DRAFT`,
   account picker; verify draft-with-thread-id support.
3. **MOO-494 — Zola drafts:** `draft_email` tool (to/reply_match/intent),
   Claude drafting with thread context, "Zola drafted" surfacing on /mail,
   persona instructions; provision.

## Error handling

- Sanitizer failure → plain-text fallback of the message body, never raw HTML
- Composio auth errors reuse `GoogleAuthError` ("run connect-google again")
- Draft replace is two calls (delete+create): if create fails after delete,
  the editor still holds the content — retry from the client, nothing lost
- Send failures keep the draft in Gmail (atomicity of SEND_DRAFT)

## Testing

- Unit: sanitizer fixtures (script tags, on* attributes, forms, style
  survival), address/thread parser helpers
- Prod per issue: real thread renders in-app; a draft created in-app appears
  in the Gmail app; send-to-self round trip lands in inbox with formatting;
  voice-drafted reply reads correctly against its thread
