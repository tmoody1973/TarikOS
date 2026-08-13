# Handoff — Tarik OS, 2026-08-12 (morning)

Three things, in this order. The first two are cheap and make the third
cleaner, so resist doing the third first.

1. **Reshape the prompt**, with the eval as before/after.
2. **Update the inbox spec** with four decisions made after it was written.
3. **Build Zola's inbox**, starting with reading what arrives.

**Read first**
- `docs/superpowers/specs/2026-08-12-zola-inbox-design.md` — the inbox design.
  It is missing the four decisions in §2 below; make those edits before building.
- The commit messages from 11–12 August. They carry the reasoning.
- Traps, at the bottom. Each one cost real time.

## State

`main` in sync with origin. **869/869 tests, tsc clean, `next build` green.**
Convex deployed, agent provisioned, Vercel deployed.

The prompt is reshaped (persona 12,724 → 4,191 chars), the spec carries the four
decisions, and `check_zola_mail` is LIVE — verified in production against the
real inbox. Read "Where the three items landed" below.
Convex deployed, agent provisioned, Vercel deployed. A push to `main` ships the
Convex schema and the app together.

47 tools published. Working tree carries only `.claude/`, which is not yours to
decide on.

Shipped since the last handoff: Plane projects and a board, a task detail panel,
scheduled reminders with due dates, and two bug fixes worth reading as a class
rather than as incidents (see Traps).

---

## 1. Reshape the prompt, measured

### The problem, in numbers

```
persona                12,724 chars   (2,199 words)
103 tool descriptions  12,381 chars
habit guardrails          650 chars
                     ─────────────
standing prompt        25,755 chars   every session
```

Half of it is tool descriptions, and **the persona restates most of them**.
`create_task`'s description and its persona paragraph say nearly the same thing
in different words. Two surfaces, no test that they agree, both growing with
every feature.

The rot mechanism is precise: **a tool's description cannot outlive its tool; a
persona paragraph can.** Delete a tool and its description goes with it. Delete
a tool and its paragraph sits there forever describing a capability that no
longer exists. Nothing today would catch that.

### The principle

**One source of truth per fact, chosen by the fact's lifetime.**

| Lifetime | Home | Example |
|---|---|---|
| Same as the tool | the tool's `description` | when to call `create_task`, what `due` wants |
| Spans tools | the persona | which inbox is whose; a task is not a reminder |
| Changes per session | dynamic variables | `{{standing_context}}` |

All three patterns already exist here. `{{standing_context}}` is the third one
done well. The first has never been applied consistently, so per-tool mechanics
live in both places.

### What to actually do

- **Move mechanics down** into each tool's `description`. Arguments, when to
  call it, what a failure means. It is already given to the model in the same
  context, so it costs nothing extra and cannot drift from the tool's existence.
- **Leave judgement up** in the persona. Distinctions, precedence, rituals that
  span tools: *your inbox is Gmail, mine is zola@*; *a task is a thing to
  finish, a reminder is an interruption*; *read the blueprint back and wait*.
- **Move `{{standing_context}}` to the END.** It currently sits at char 504,
  3% in, with 12,220 characters of stable text behind it. Under any prefix
  caching scheme, a memory changing overnight invalidates the entire tool
  roster. Free to fix, helps if ElevenLabs caches, harmless if they do not.
- **Hoist the invariants.** "Lost in the Middle" (Liu et al., 2023) is the
  well-replicated finding that models attend more reliably to the start and end
  of a long context. *She never sends mail. She never picks between two
  matches.* Both are currently buried mid-persona.
- **Add the seam test.** Every tool named in the persona must exist in `TOOLS`.
  Ten lines, mirrors `tests/textTools.test.ts`, catches exactly the rot above.

### Measure it; do not trust the reasoning

`evals/replay.py` exists for this and already has the mechanism:

```bash
python evals/replay.py --save before     # before touching anything
#   … do the reshape …
python evals/replay.py --compare before  # prints every utterance that changed
```

Read its docstring first. Two things in it matter here: absolute numbers do not
match production (different serving, no audio, one turn of history), so **the
delta is the thing**; and two identical runs disagree on about 9% of utterances,
so a two-point move is noise. Save a Phoenix run if the result is worth keeping.

If selection holds or improves, roughly 6k characters of standing prompt were
cut for free. If it drops, that is worth more than the saving.

### One caveat to carry

**Caching makes a bloated prompt cheap, not effective.** Cache hits cut cost and
latency; the model still attends to every token. It is an argument for fixing
the ordering, never an argument against trimming.

The two channels differ:

- **Zola (voice)** — ElevenLabs owns the inference call. Whether they cache is
  invisible and uncontrollable from this repo.
- **Telegram** — `src/app/api/telegram/inbound/route.ts` constructs
  `new Anthropic()` directly and there is **no `cache_control` anywhere**. That
  system prompt plus `TEXT_TOOLS` is stable across every message in a
  conversation: a textbook cache prefix, currently unused.

---

## 2. Four decisions the inbox spec is missing

The spec was written before the Gmail relationship was thought through. These
came out of that and are not yet in the file.

**The organizing principle.** *Gmail is where Tarik is a person; `zola@` is
where Zola is an agent.* The line is whose identity is on the envelope, which is
the line the system already draws: `draft_email` writes as Tarik and he releases
it; `email_tarik` writes as Zola to him and needs no release. Anything addressed
to the world as Tarik requires Tarik.

**A forward grants attention, not authority.** The spec says nothing arriving by
mail can cause a write. Refine it: a forward is Tarik's gesture, so it earns her
attention — she may summarize, extract a date, propose something. It does not
make the *content* trustworthy. If a forwarded email says "wire $5,000", she
reports that it says so and proposes nothing of the sort.

**A forwarded thread replies through Gmail, not from `zola@`.** The
correspondent knows Tarik, not Zola; a reply from a stranger's address is wrong
almost every time. So a forwarded thread produces a Gmail draft as him.
`draft_email` already resolves by `reply_match` against his own threads, and the
original is in his Gmail because that is where he forwarded it from. **`zola@`
is the intake; Gmail is the outlet**, for anyone who knows him.

**The allowlist governs auto-processing, not storage.** As specced it is too
strict: a confirmation from a service she signed up with would arrive from an
unknown sender and be ignored. Correct rule — unlisted mail is stored, listed
and readable when asked for by name; only allowlisted senders reach her
reasoning context automatically. A stranger never gets auto-summarized into the
morning brief; a confirmation is still there when she looks for it.

**And the surface: a tab under `/mail`, not a new nav destination.** Tarik's
call, and the better one. A tab means *sibling views of one domain*: both
visible, labelled, mutually exclusive, so it is always obvious which mailbox you
are in. A separate nav cap would let him land on hers thinking it was his, the
exact confusion the identity split exists to prevent.

- `/mail/zola`, not a query parameter. `isActiveRoute` matches on `startsWith`,
  so the MAIL cap still lights and the nav needs no change.
- Her tab carries a different accent. `/mail` is lavender because it is his;
  hers must read as not-his at a glance.
- An unread count on the tab, plus a line in the morning brief. Her inbox has to
  surface to him rather than wait to be checked, or it is a second place to
  remember to look.
- The spec calls a separate page "a twelfth nav destination". It would be the
  thirteenth; there are already twelve.

---

## 3. Build Zola's inbox

### Reconnaissance, already done against the live API

Do not re-derive this.

| | |
|---|---|
| Base URL | `https://api.agentmail.to/v0` |
| Auth | `Authorization: Bearer $AGENTMAIL_API_KEY`. **`X-API-Key` returns 401** |
| Key | in `.env.local`. **Not yet in Vercel** — add before anything server-side ships |
| Inbox | `zola@tarikos.app` **already exists and receives**; the domain is verified |
| Others on the account | `triton-ingest@`, `mke-alerts@`, `tarik@agentmail.to` |
| List | `GET /inboxes/{inbox}/messages` → `{count, messages[]}` |
| One message | `GET /inboxes/{inbox}/messages/{urlencoded-message-id}` |

Message fields: `message_id`, `thread_id`, `from`, `to`, `subject`, `timestamp`,
`preview`, `labels`, `size`, `text`, `html`, `attachments`.

**The finding worth building on.** The first real email was 20.9 KB and roughly
**two percent of it was content** — one line, then a signature block with phone
numbers, social links and a playlist. AgentMail's own `preview` field already
cuts at the signature boundary. `summarize()` should lean on `preview` rather
than `text`, or every summary of a real email is mostly a signature.

### What to build first

`check_zola_mail` and forward-handling. The smallest thing that makes the inbox
earn its existence, and it needs no sending at all. Sending to Tarik and
drafting to the world come after, per the spec.

Done. `src/lib/resend.ts` is deleted, `emailOwner` moved into
`src/lib/agentmail.ts`, and reminders arrive from `zola@tarikos.app`. One email
provider. The rule is unchanged by the move: the recipient comes from
`OWNER_EMAIL` on the server and is not a parameter of anything.

---

## Traps

The first two are worth reading as a **class**, not as incidents.

- **Every tool argument is declared as a STRING.** `bodyProp` types everything
  that way, which is right for 45 arguments and was wrong for exactly one:
  `create_plane_project`'s confirmation. The route tested `body.confirmed !==
  true`, the agent sent `"true"`, and **Tarik could never confirm a project, no
  matter what he said.** There is a `boolProp` now, but the durable rule is:
  **never compare a tool argument against `true` in a route.** Check by value.
  The guardrail that should have caught it asserted a blueprint branch existed.
  It did exist. It was unreachable from the only caller that matters.
- **A derived identifier collides.** Two Plane projects a minute apart both
  produced `ZZZFIXCH` at the eight-character cap, and Plane refused the
  duplicate as "the tool hit an internal error". Real names do it too: "Pledge
  Drive 2026" and "2027" both give `PLEDGEDR`. Derive against what already
  exists, and surface the provider's own refusal instead of a generic error.
- **`end_call` DOES close a browser WebRTC session.** Undocumented — the docs
  cover it for phone calls and say nothing about WebRTC — so it was worth
  checking rather than assuming. Verified out loud on production: Zola says
  goodbye, the transport closes, `onDisconnect` fires and the dock returns to
  STANDBY on its own. No client-side listener needed.
- **AgentMail enforces its OWN allow list on outbound RECIPIENTS**, and an
  empty list denies everyone except the human's address. This is why reminders
  to Tarik always worked and the first letter to a stranger came back
  `MessageRejectedError: Recipient(s) blocked: … (not in allow list)`. Nothing
  in this codebase was wrong; the provider had a second gate nobody had opened.
  The route now calls `allowRecipient()` after the reply decision passes, and a
  guardrail asserts that ordering. Read the `fix` field on an AgentMail error —
  it names the exact endpoint, and it is how this was found.
- **AgentMail reports NO `dkim` field.** The verdict lives inside the
  `Authentication-Results` header as free text, among the client IP and the helo
  name — `"…; dkim=pass header.i=@gmail.com; dmarc=pass…"`. The first version of
  the auto-reply read `message.dkim`, which does not exist, so every sender
  failed the gate and the letter would simply never have been sent to anybody.
  It would have looked like a working feature nobody happened to trigger. Caught
  by reading one real message before shipping, not by a test.
- **An ElevenLabs system tool goes in `tools`, NOT in `built_in_tools`.** The
  agent config has a `built_in_tools` map with an `end_call` slot, and writing
  to it does nothing whatsoever: the API returns **200**, reports success, and
  leaves the value `null`. The SDK serialises the field correctly, so nothing
  in the request is wrong — the server just ignores it. A system tool has to go
  in the `tools` array like any other, and the API then REFLECTS it back into
  `built_in_tools` on read, which is precisely what makes the wrong shape look
  like it worked. Read the tool back from the live agent after provisioning;
  the script's own "Updated agent" line proves nothing.
- **`CONVEX_DEPLOY_KEY` in `.env.local` SHADOWS your Convex login.** Every CLI
  command uses it instead, and it carries only `deployment:deploy`, so
  `npx convex data` fails with a permission error that reads like the account
  lost access. Commented out there now; Vercel's build is the only thing that
  needs it. `CONVEX_DEPLOY_KEY= npx convex …` clears it for one command.
- **`git push` deploys now.** `vercel.json` runs
  `npx convex deploy --cmd 'npm run build'` in the production build, gated on
  `VERCEL_ENV` because a production key on a preview build would overwrite the
  production schema. A green local `next build` is the last gate before live.
- **`npx vercel --prod` no longer deploys**; it builds and asks you to promote.
  Use `npx vercel deploy --prod`.
- **Splitting a route case on the first `}` lands inside a template literal.**
  Two guardrails asserted `doesNotMatch` against a string cut off before the
  thing they forbade. Split on the branch's own closing brace.
- **An ordering assertion can read source position when it means evaluation
  order.** `rankSources(` is written before `archivedAt` and evaluated after it.
- Clerk-gated Convex functions are unreachable from `npx convex run`. Verify
  those in the browser.
- Earlier traps still stand: codegen is not deploy, no `.npmrc`, read past the
  shadcn installer's file list, screenshots are upscaled, Grammarly blocks
  synthetic typing, localhost Clerk loops.

## Known gaps, deliberately left

- **Reminders cannot phone him.** Zola can ring him via `call_tarik`, but three
  tests assert exactly one dialling site whose destination is not a parameter
  anywhere. A reminder was not worth a second one. "Call me" sets a Telegram
  reminder and **says so**.
- **The board's due-date badge has never been seen on screen.** Built; no task
  in the workspace has a due date yet.
- **`planeLinks` was specified and not built.** Nothing populates it, and a
  table with no writer is scaffolding.
- **No Studio Sources picker UI.** `studioSources` is backend-only and always
  has been.
- **⌘J in Studio applies directly** through Plate's own menu; it does not create
  a `studioProposals` row. The voice path and the screen path share the table
  but not yet the menu.
- No PDF export, no Canvas, no iCloud sync, no Plane webhooks or Wiki.

## Where the three items landed

1. **Prompt reshaped.** Persona 12,724 → 4,191 chars; the standing prompt is
   ~18,000 rather than 25,755. Mechanics moved into 17 tool descriptions,
   invariants hoisted to the opening, `{{standing_context}}` moved to the end.
   `tests/personaSeam.test.ts` is the new seam guard and it bites (a mutation
   case proves it). **Measured across three runs: 72.9% → 71.0%, 71.0%, then
   72.0%.** The first two after-runs lost two utterances, both
   `create_calendar_event → web_research`. The calendar description then
   changed to lead with what the tool is FOR before its read-back ritual, and
   that confusion class disappeared: 72.0%, one utterance off the baseline and
   inside the harness's own noise. **Selection held. 8,533 characters gone.**
2. **Spec corrected.** All four decisions plus the `/mail/zola` tab. Open
   questions 2 and 3 are struck through and answered rather than deleted.
3. **The inbox is built, live and on screen.** `agentmailLib.ts` (pure, 43
   tests), `agentmail.ts` (the boundary), `check_zola_mail`, and the surface at
   **`/mail/zola`** — a tab beside his, hopbush against lavender, with an
   unread badge taken from AgentMail's own label. The reader fetches the body
   on demand and renders it as plain text, never a stranger's HTML.

   Reminders moved too: `resend.ts` is deleted and `emailOwner` lives in
   `agentmail.ts`, so reminders arrive from `zola@tarikos.app`. One provider.

   The morning brief gained a step — `check_zola_mail` with `as: count`, an
   argument deliberately absent from the published schema. A brief is built
   unattended and read aloud, so it says how much arrived and never what a
   stranger wrote. `workflows:seedPhase2` has been re-run, so the deployed
   workflow carries it.

   Two bugs the screenshots caught that the tests had not: her own outgoing
   reminder came back in the inbox list and would have counted as an arrival,
   and the "forwarded" / "not on your list" tags were being clipped by the
   truncating summary line. Both fixed; the first has a test.

## What is left of the inbox spec

- **`email_tarik` and `draft_reply`** — the sending half she calls herself. She
  writes to him freely (the privileged-recipient rule, which `emailOwner`
  already implements) and drafts to everyone else. A forwarded thread must draft
  through GMAIL as him, not from `zola@`, because the correspondent knows him
  and not her.
- **Attachments** are stored by AgentMail and ignored here, by choice.

The webhook is built. `/api/agentmail/inbound`, Svix-verified against the raw
body, idempotent on the message id, exempt from Clerk. Webhook
`ep_3Hp8TMxBnfIoY4HXQ1zkJdtcdNr` is scoped to `zola@tarikos.app` only — the
account has two others for different inboxes and they were left alone.

## The wake word

Built and shipped dark. `/api/wake/key` returns 404 while `PICOVOICE_ACCESS_KEY`
is unset, and the dock reads that and never offers to arm — an absent key is an
absent feature rather than a button that throws.

- **openWakeWord, on-device, Apache-2.0 code AND models.** No account, no key,
  no approval. Three ONNX models in `public/wake/models` — melspectrogram,
  speech embedding, phrase classifier — chained in the browser.
- **She answers to "Hey Zola."** Trained on Hugging Face hardware for under a
  dollar: 60,000 steps in 9.6 minutes, 161 KB, recall 0.9995, 0.168 false
  positives per hour. The run is `docs/lessons/hey_zola.train.yaml` (566 bytes,
  reproduces all 17GB) and the metrics are beside it.
- **Threshold 0.07, and the digit is not a typo.** A THRESHOLD BELONGS TO A
  MODEL, NOT TO A CODEBASE. The previous model wanted 0.7; carrying that number
  across would have armed perfectly and never fired once. A guardrail now reads
  the trained metrics file and fails if the two disagree, so retraining the
  phrase cannot silently leave the old cut behind.
- **The detector is released while a session is live.** ElevenLabs' own guide
  stops its mic stream before `start_session` "to avoid conflicts", and there is
  a second reason it does not give: a detector left running hears Zola through
  the speakers and triggers on her. This is also why the STOP word is `end_call`
  and not a local one — nothing local can listen while she is talking.
- **A chime fires on detection**, before the session connects, because token
  mint plus WebRTC is one to two seconds and silence reads as "it didn't hear
  me".

**The ceiling, stated plainly:** browsers reject or suspend `getUserMedia` on
backgrounded pages by design. This is always-on *while the tab is in front of
you*, never an Echo on the counter. Counter-top is a Raspberry Pi and
[ElevenLabs' own guide](https://elevenlabs.io/docs/eleven-agents/guides/integrations/raspberry-pi-voice-assistant),
which is a different device and a different project.

**Two engines were rejected, both for the same reason and both worth not
re-litigating.** Picovoice: Console signup gated behind company approval, and a
monthly slot to train a phrase. DaVoice (`web-wake-word`): MIT code, but the
runtime is licence-key gated and their own README's example key decodes to an
expiry of 2025-07-14 with the comment "Check for the latest License"; custom
words are an email to a person at an unpublished price, and the licence on the
MODELS is never stated — which matters in a public MIT repo. An assistant that
stops hearing its owner on a date somebody else picks is not the thing being
built here.

**Verified out loud on production, 12 August:** she answers to "Hey Zola,"
first try. Still unmeasured: how often it false-fires over a full working day
with the radio on. That number, not the validation figure, decides whether 0.07
stays.

## Open, needs Tarik

- **Send another email to `zola@tarikos.app` from a third address.** The first
  one is stored with its failure reason and will not be retried — deliveries are
  idempotent on the message id, so it needs a fresh message.
- **Say "check your mail" to her out loud.** Everything below the voice layer
  is verified in production; the spoken path is not.

- **Watch tomorrow's morning brief** for the inbox line. The step is deployed
  but has never run on a schedule.
- **Open an exported .docx in Word** and confirm it is not corrupt. Open since
  three handoffs.
- **MOO-529** — thirty seconds in airplane mode. Open since five.
- **iCloud app-specific password**, if the iCloud half of MOO-499 is wanted.
- Plane's seven onboarding tutorial items are still in "Moody and Co", and
  `mkedev` shows on the board alongside it.

**Settled, do not raise again:** the Telegram token rotation; `.env.local`'s
missing variables (they are in Vercel — verify against production); Studio's
shadcn exception; Studio's text recall having no search index; Plane having no
mirror tables and no MCP server; AtomicMail (evaluated, lost to AgentMail).

## Tarik

They/them. Decisive, and dislikes re-litigation. Answers very short, so put the
recommended option first and make it unambiguous.

**Read the length of the question.** A one-word question wants a one-line
answer. He will attach "ultrathink" when he wants the long version, and those
are worth answering properly.

He pushes back accurately and it is usually a correction worth taking.
Yesterday: "read-only is stupid" when the Plane workspace was empty, and the
send rule for `zola@` — *she writes to me freely, drafts to everyone else* —
which was better than either option offered and collapsed two rules into one
sentence.

Write in plain language. Lead with what he can do now.

## Suggested skills

- **`superpowers:test-driven-development`** — everything that landed cleanly
  went through it, and the mutation sweep is where the value is.
- **`superpowers:verification-before-completion`** — before any "done".
- **`soundshuman:humanize`** for prose. Note its voice-calibration rule: a
  writing sample outranks its own style rules. Tarik asked for em dashes gone
  from the README regardless, so that is settled there.
- **`ponytail`** — active throughout.

`npx next build` before saying done. Pushing `main` deploys everything.
