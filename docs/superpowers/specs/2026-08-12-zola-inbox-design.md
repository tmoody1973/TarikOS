# Tarik OS — Zola's own inbox

**Date:** 2026-08-12
**Status:** Proposed — pending review
**Milestone goal:** Zola has an address. Tarik forwards her a confirmation and
she files it; he asks what came in and she tells him; she writes to him freely
and to anyone else only as a draft he releases.

## What this is

Zola can read Tarik's Gmail today and draft replies he sends. She has no
identity of her own in email: nothing can be addressed to her, no service can
send her anything, and there is no thread that is hers rather than his.

This gives her one at **zola@tarikos.app**, on
[AgentMail](https://agentmail.to), which Tarik already has an account with.

> **The rule that shapes everything below.** An inbox is a public front door
> into an agent's context. Anyone who learns the address can put text in front
> of her. So mail is DATA, never instructions, and the controls are structural
> rather than prompt-level.

## Why AgentMail

Evaluated against AtomicMail (raised first) and against a Gmail alias.

| | AgentMail | AtomicMail | Gmail alias |
|---|---|---|---|
| Status | Production, SOC 2 | Open alpha | Production |
| Registration | API key | Proof-of-work, ~30s scrypt | Existing |
| Inbound | Webhooks with signature verification, plus WebSockets | JMAP | Composio poll |
| **Allow/block lists** | **First-class feature** | Not documented | Build it yourself |
| Human-in-the-loop | **Drafts are a first-class resource** | No | Gmail drafts |
| Spam and virus scanning | Yes | Not documented | Yes |
| Custom domain | SPF, DKIM, DMARC | Not during alpha | n/a |
| Identity | Separate from Tarik | Separate | **Shares his mailbox** |

A Gmail alias is the one to rule out on principle rather than features: it puts
her inside his mailbox, so "her" mail and his are the same store and any mistake
reaches his correspondence. A separate identity is the point.

AtomicMail is interesting and too early. An inbox that has to receive a booking
confirmation is the wrong thing to put on an alpha.

AgentMail's two decisive features are the two this design needs most, and
neither is something to hand-roll: allow/block lists on both directions, and
Drafts as a resource so a pending reply has somewhere to live that is not a
table invented here.

## Decisions made

| Decision | Choice |
|---|---|
| Provider | AgentMail |
| Address | `zola@tarikos.app`, custom domain from the start |
| Sending to Tarik | **Free, no ceremony.** Same privilege as `call_tarik` |
| Sending to anyone else | **A draft he releases.** She never sends outward unattended |
| Inbound processing | **Allowlisted.** Everything else is stored and ignored |
| Inbound authority | **None.** Mail can never trigger a write on its own |
| Resend | **Removed.** Reminders move to AgentMail; one email provider |

### The privileged-recipient rule

She may send to `OWNER_EMAIL` with no confirmation, because that is a
notification to the person who owns the system, not correspondence. This is the
`call_tarik` shape, now applied to mail: **the privileged recipient is not a
parameter of anything**, it comes from the server.

Everything else is a draft. AgentMail holds it; Tarik releases it. That is the
same rule as Gmail's `draft_email`, so there is one sentence to remember about
Zola and email rather than two: *she writes to you; she drafts to everyone
else.*

### Inbound mail is data, never instructions

This is the part that would be easy to get wrong, and the reason the feature is
worth a spec.

- **An allowlist gates processing**, not just replying. Mail from an unlisted
  sender is stored and never summarized into her context. Tarik OS already does
  this twice — `src/lib/smsAllowlist.ts` and `src/lib/telegramAllowlist.ts` —
  and this is the third instance of the same rule, not a new idea.
- **Nothing arriving by mail can cause a write.** No task, no calendar event, no
  reminder, no send. Mail can produce a briefing card or a proposal; a person
  turns it into an action. The proposal pattern already exists in
  `studioProposals`.
- **Quoted content stays quoted.** When a message is summarized into a card or
  read aloud, it is presented as *what an email said*, never as something Zola
  concluded or was told to do.

## Architecture

```
  someone → zola@tarikos.app → AgentMail
                                   │ webhook (signed)
                                   ▼
                        /api/agentmail/inbound
                                   │ verify signature
                                   │ allowlist check
                                   ▼
                        Convex: zolaMail rows
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             /inbox (a surface)            recall / briefs
```

Outbound rides the same client:

```
  remind_me / email_tarik → src/lib/agentmail.ts → AgentMail → Tarik
  draft_reply             → AgentMail Drafts     → he releases it
```

`src/lib/agentmail.ts` is the only file that knows AgentMail's API, in the shape
of `plane.ts` and `googlePeople.ts`. Pure shaping goes in `agentmailLib.ts` so
the allowlist and summarization rules can be tested without a network.

## Components

- **`agentmailLib.ts`** — `allowedSender()`, `summarize()` (subject, from, first
  words, never the full body), `threadKey()`. Pure and tested.
- **`agentmail.ts`** — the API boundary: send, create draft, list messages, get
  message. Cursor-paginated reads follow to the end, the lesson from Plane.
- **`/api/agentmail/inbound`** — the webhook. Verifies the signature BEFORE
  parsing, is exempt from Clerk in `proxy.ts` alongside `/api/tools`, and is
  idempotent on the message id.
- **Convex `zolaMail`** — one row per accepted message: from, subject, summary,
  receivedAt, threadId, read. The body is NOT copied; AgentMail holds it and it
  is fetched on demand.
- **Tools** — `check_zola_mail` (what came in), `email_tarik` (writes to him),
  `draft_reply` (writes to anyone else, as a draft).
- **A surface** — where mail lands and where a draft is released. `/mail` is
  Tarik's Gmail and should stay his; this is a panel or a small page of its own.

## Guardrails to write as tests

- The privileged recipient is not a parameter of any tool. *Same test as the
  Resend one, moved.*
- No tool sends to an arbitrary address without producing a draft.
- The webhook verifies its signature before parsing the body.
- An unlisted sender's mail is stored but never summarized into context.
- No inbound path calls `create_task`, `create_calendar_event`, `remind_me`, or
  any send.
- `AGENTMAIL_API_KEY` is read from the environment and never defaulted.
- The Gmail no-send guardrail still passes, untouched.

## Non-goals

- **Zola sending outward unattended.** Explicitly deferred; it is the decision
  this spec exists to avoid making by accident.
- **Attachments.** Receiving them is fine to store a reference to; parsing them
  is a separate feature.
- **Her own contacts, calendar invites, or unsubscribing from anything.**
- **Migrating Tarik's Gmail.** `/mail` is unchanged.

## Open questions

1. **What is on the allowlist on day one?** Tarik's own addresses, certainly.
   Anything else needs a reason.
2. **Where does her mail surface?** A panel on `/mail`, a zone on the home HUD,
   or its own page. Its own page is cleanest but is a twelfth nav destination.
3. **Should an accepted message reach the morning brief?** Probably, and only as
   "three things arrived", not as content.
4. **Does she get her own semantic memory over mail?** The rule from Studio says
   AgentMail owns the messages and Tarik OS stores links plus summaries, which
   is what `zolaMail` does. Embedding the summaries is a later, separate call.
5. **Reminders move to AgentMail — when?** They work on Resend today with no key
   set. Simplest is to build the AgentMail client first, then swap `emailOwner`
   to it and delete `resend.ts` in the same change.

## What is needed before building

- **`AGENTMAIL_API_KEY`** in `.env.local` and Vercel.
- **DNS on tarikos.app.** AgentMail's Get Zone File endpoint returns the SPF,
  DKIM and DMARC records; they go in Cloudflare, then Verify Domain.
- Reconnaissance against the live API before any code. The Plane build proved
  the documentation wrong about a required field, and the rule now is that a
  vendor's shapes are read from the vendor, not from its docs.
