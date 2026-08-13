# Handoff — Tarik OS, 2026-08-12 (evening)

Everything shipped today is verified out loud, so the top of this is short and
**the Traps are where the value is.** Five are new, and four of those are the
same shape: an operation that reported success and did not happen. That class
cost more time today than every genuine error combined.

**Read first**
- Traps, at the bottom.
- `docs/superpowers/specs/2026-08-12-zola-inbox-design.md` — revised and mostly
  built.
- The commit messages from 12 August. They carry the reasoning.

## State

`main` in sync with origin. **944/944 tests, tsc clean, `next build` green.**
Convex deployed, agent provisioned, Vercel deployed. 36 commits today.
Working tree carries only `.claude/`, which is not yours to decide on.

Shipped, and how each was verified:

| | Verified |
|---|---|
| Standing prompt reshaped, 8,533 chars cut | eval harness, three runs |
| `check_zola_mail` and the `/mail/zola` tab | production, on screen |
| Reminders on AgentMail; `resend.ts` deleted | real email received |
| `end_call` — she hangs up on a goodbye | said out loud, dock went to STANDBY |
| The letter a stranger gets | Tarik got one |
| **Wake word: "Hey Zola"** | said out loud, first try |
| `email_tarik` and `draft_reply` | both called live; he has the email, the draft is still a draft |
| **The brief writes its own lede** | production built one and it found a calendar collision no section could |

Also written: a build diary, a plain-English ML lesson, a LinkedIn post, and an
11-page design paper in `docs/paper/`.

## What is next, in order

**1. Count the false fires.** The wake word's 0.168-per-hour figure came from
synthetic validation audio. Tarik's office has voices and music in it most of
the day, which is close to adversarial. That number, not the validation one,
decides whether the 0.07 threshold stays. Peak scores above 0.2 print to the
browser console, so a normal working day produces the data for free.

**1b. Read a week of ledes before touching the prompt.** The first one was
good. One is not evidence. The knobs, in the order worth turning: the 50-to-80
word target in `LEDE_BRIEF`, and `ledeInput`'s `\s+ -> " "` collapse, which
flattens a twelve-bullet Inbox section into one run-on line and is the obvious
first suspect if the quality disappoints.

**2. Give the draft somewhere to be released.** `draft_reply` now parks a real
letter in AgentMail, and the only place to release it is AgentMail's own
dashboard. That is the "a control nobody knows to press" trap with a different
hat on. A Drafts tab and a Send control on `/mail/zola` closes it; the endpoint
is `POST /v0/inboxes/{inbox}/drafts/{id}/send` and it is confirmed to work.

**3. Publish.** `docs/lessons/post-linkedin.txt` is 2,881 of 3,000 characters
and ready to paste. The paper wants a second read first.

**4. Re-run the replay eval.** Two tool descriptions were added to the standing
prompt after it was reshaped to 72%. `evals/tools.json` was regenerated so the
harness scores what shipped, but the number has not been taken since.

## The wake word, since it is new

`hey_zola.onnx`, 161 KB, in `public/wake/models`. openWakeWord in the browser,
Apache-2.0 code and models, no account and no key. Trained on a rented Hugging
Face L4 for under a dollar: 60,000 steps in 9.6 minutes, recall 0.9995,
accuracy 0.9997, 0.168 false positives per hour.

The 566-byte config that reproduces the entire 17GB run is
`docs/lessons/hey_zola.train.yaml`, metrics beside it. The 17GB was deleted; it
all lives on Hugging Face.

- **The detector is released while a session is live.** ElevenLabs' own guide
  stops its mic before starting a session, and there is a second reason it does
  not give: a detector left running hears Zola through the speakers and triggers
  on her. This is also why the STOP word is `end_call` rather than a local one.
  Nothing local can listen while she is talking.
- **The ceiling, stated plainly:** browsers suspend `getUserMedia` on
  backgrounded pages. This is always-on *while the tab is in front of you*,
  never an Echo on the counter. Counter-top is a Raspberry Pi and a different
  project.
- **Two engines were rejected; do not re-litigate.** Picovoice gates signup
  behind company approval and charges a monthly slot per phrase. DaVoice ships
  MIT code whose runtime is licence-key gated, and their own README's example
  key decodes to an expiry of 2025-07-14 under the comment "Check for the latest
  License".

## The lede, since it is new

A brief used to be a stapler: `workflowRunner` walked its steps and
`formatSection` put each result under its own heading, and nothing in the
pipeline ever saw two sections at once. Now one model call at the end of the run
reads every section plus the previous brief's own lede, and writes the paragraph
the brief opens with. `get_brief` returns it as the thing Zola speaks, the
Telegram digest puts it in the header where truncation cannot drop it, and
`/briefs` renders it above the columns.

The first one production wrote, unedited:

> Two things collide at eleven — the vibe coding show and tell and your Teams
> call with Jeff Freeland Nelson. One of them needs to move, and only you can
> pick. Noon is double-booked too, but both are Python, so that's just
> redundancy. All three goals moved this week, which is rare. And Anthropic's
> being talked about as a two trillion dollar IPO — worth a glance, given the
> certification you're chasing.

That is the argument for the feature in one paragraph. The calendar section can
only list events; it cannot notice that two of them collide. The headlines and
the goals live in different columns and had never been able to see each other.

- **The writer is not Zola.** It is a separate call holding the sections and
  nothing else — no tools, no telos, no memory. This is the first thing in the
  system that turns a Gmail subject or a search snippet into her OWN words
  rather than a quotation, so it borrows `zolaReply`'s containment whole.
- **`write_lede` is runner-only.** It is a case in the tool route and it is
  deliberately absent from `provision-agent.ts`, the shape `send_brief_digest`
  established. She reads a lede; she can never write one.
- **Truncation is a refusal, not something to salvage.** If `stop_reason` comes
  back `max_tokens`, the tool returns `ok: false` and the brief ships without a
  lede. A paragraph cut off at the ceiling is the opening of a thought that was
  going somewhere else.
- Design: `docs/superpowers/specs/2026-08-13-brief-lede-design.md`. Plan and the
  full review trail: `docs/superpowers/plans/2026-08-13-brief-lede.md`.

## Traps

- **A test that cannot fail is worse than no test, and I wrote five of them.**
  Six tasks went through spec review, quality review and a scoped re-review.
  Every finding but one was a defect in the PLAN, not the implementation — and
  five were source-scanning tests that passed no matter what the code did. One
  regex reached 100 lines past its function into `seedPhase2` and matched the
  words "cron" and "trigger" there. One asserted a `continue`-not-`break`
  behaviour on a fixture too small to ever reach the branch. One checked the
  whole `get_brief` case body, so moving a `??` two lines away satisfied it while
  the actual field reverted. The fix that worked, every time: **mutate the source
  the test claims to protect, watch it fail, restore it, watch it pass.** If it
  passes under both spellings it is decorative. Make that the acceptance
  criterion in the task, not a suggestion.
- **A guard that protects one path can break another.** `finishBrief` refuses to
  overwrite a lede with `undefined`, so a failed retry cannot erase a good one.
  Correct on its own. But `createOrResetBrief` cleared `sections` and not `lede`,
  so a REBUILD whose writer failed finished `ready` with twelve new sections and
  the previous run's paragraph on top — Zola confidently narrating a brief that
  no longer existed. Only the whole-branch review caught it; six per-task reviews
  could not, because neither half is wrong alone.
- **A tool description is not scoped to a trigger.** The morning instruction
  "read the paragraph and STOP" was safe in the persona bullet, which fires on a
  greeting. Put in the `get_brief` DESCRIPTION it applied to every call —
  including the weekly review, which had a lede of its own and a persona bullet
  telling her to WALK it item by item. Nothing in the returned data let her tell
  the two apart, so the Sunday telos ritual would have died silently. The fix was
  structural, not a wording plea: `get_brief` now returns `data.workflow`.
- **Probing an endpoint named after a verb PERFORMS the verb.** Mapping
  AgentMail's drafts API, a `POST /drafts/{id}/send` went out purely to find
  whether the route existed. It existed, and it sent: a real email, body "probe
  body", to `moodyco1973@gmail.com`. It reached Tarik and not a stranger only
  because his own address is the one thing on the outbound allow list. A 404
  control against a neighbouring bogus path was run — one call too late. Run
  the control FIRST, and never let the reconnaissance call be the destructive
  one; a bogus sibling path answers "does this route exist" for free.
- **A guardrail can assert that something does not exist yet.**
  `zolaMailGuardrail` carried `assert.doesNotMatch(PROVISION, /email_tarik|
  draft_reply/)` — a not-yet-built marker that reads exactly like a rule. When
  the feature lands, replace it with the rule it was standing in for. Deleting
  it silently drops the real constraint; leaving it blocks the build. This is a
  good pattern and worth repeating, as long as the next person recognises it.
- **An ElevenLabs system tool goes in `tools`, NOT in `built_in_tools`.** The
  config has a `built_in_tools` map with an `end_call` slot, and writing to it
  does nothing: the API returns **200**, reports success, leaves the value null.
  The SDK serialises the field correctly; the server ignores it. A system tool
  goes in the `tools` array like any other, and the API then REFLECTS it into
  `built_in_tools` on read, which is exactly what makes the wrong shape look
  right. Read the tool back from the live agent after provisioning; the script's
  own "Updated agent" line proves nothing.
- **AgentMail reports NO `dkim` field.** The verdict sits inside the
  `Authentication-Results` header as free text, among the client IP and the helo
  name: `"…; dkim=pass header.i=@gmail.com; dmarc=pass…"`. The first version
  read `message.dkim`, which does not exist, so every sender failed the gate and
  the auto-reply would never have been sent to anybody. No error, no symptom.
  Caught by reading one real message off the live API.
- **AgentMail enforces its OWN allow list on outbound RECIPIENTS**, and an empty
  list denies everyone except the human's address. This is why reminders always
  worked and the first letter to a stranger came back
  `MessageRejectedError: Recipient(s) blocked`. Nothing here was wrong; the
  provider had a second gate nobody had opened. The route now calls
  `allowRecipient()` after the reply decision passes. Read the `fix` field on an
  AgentMail error: it names the exact endpoint, and it is how this was found.
- **`npx convex data` reads DEV. Production is a different deployment.** An
  empty table nearly produced a confident diagnosis that a webhook had never
  fired. It had. Use `npx convex data --prod`. A check that proves your
  instrument is lying beats the check you meant to run.
- **A threshold belongs to a MODEL, not to a codebase.** `hey_zola`'s optimal
  cut is 0.07; the model it replaced wanted 0.7. Carrying the old number across
  would have armed perfectly and never fired once. A guardrail now reads the
  training metrics file and fails if the deployed threshold disagrees.
- **openWakeWord is a STREAMING model; never skip a frame.** It carries raw
  audio, mel and embedding buffers across calls and assembles a phrase from
  CONSECUTIVE frames. A "robustness" guard that drops a frame while inference is
  busy punches holes in the audio. It works on a machine that keeps up, which is
  the most dangerous kind of correct.
- **A control nobody knows to press does not exist.** The wake word worked the
  entire time it appeared broken; nothing on screen said it had to be armed. Six
  words of copy fixed it. Before debugging a feature nobody has used, check
  whether anyone could tell it was there.
- **The `hf` CLI stores its token where the Python library does not look.**
  `hf auth whoami` said logged in while every download went out anonymous and
  got rate-limited. `export HF_TOKEN=$(hf auth token)` for anything Python.
- **Static assets must be in the middleware matcher.** `.onnx` was not, so 3.5MB
  of public model weights took a Clerk hop and came back as an auth redirect.
  The worklet (`.js`) served fine, which made it look like a model problem.
- Earlier traps still stand: every tool argument is a STRING, so never compare
  one against `true` in a route; a derived identifier collides; splitting a
  route case on the first `}` lands inside a template literal;
  `CONVEX_DEPLOY_KEY` in `.env.local` shadows your Convex login; `git push`
  deploys; use `npx vercel deploy --prod`, not `npx vercel --prod`; Clerk-gated
  Convex functions are unreachable from `npx convex run`.

## Known gaps, deliberately left

- **The morning brief's inbox line has never run on a schedule.** The step is
  deployed and `workflows:seedPhase2` has been re-run, but it has only been
  exercised by hand.
- **No adversarial testing of the inbox.** The argument that the reply-writer is
  safe is structural rather than empirical: it holds no tools and no data, so
  there is nothing to extract. Nobody has actually tried.
- **Reminders cannot phone him.** Three tests assert exactly one dialling site.
  "Call me" sets a Telegram reminder and says so.
- **The board's due-date badge has never been seen on screen.** No task in the
  workspace has a due date.
- `planeLinks` specified and not built. No Studio Sources picker. ⌘J in Studio
  applies directly rather than creating a proposal. No PDF export, no Canvas, no
  iCloud sync, no Plane webhooks or Wiki.

## Open, needs Tarik

- **Live with the wake word for a day and count the false fires.** The single
  most useful number nobody has.
- **A draft is sitting in her drafts,** `f5ad5157`, "Re: help" to
  `moodyco1973@gmail.com`. It is the live proof that `draft_reply` drafts and
  does not send. Release it or delete it; either is fine.
- **Three AgentMail cleanups from debugging:** `moodyco1973@gmail.com` was added
  to the send allow list, and two probe emails went to it — one "send-gate
  probe" and one "Re: help / probe body". All trivially reversible, none
  harmful.
- **Watch tomorrow's morning brief** for the inbox line.
- **Open an exported .docx in Word** and confirm it is not corrupt. Open since
  four handoffs.
- **MOO-529** — thirty seconds in airplane mode. Open since six.
- **iCloud app-specific password**, if the iCloud half of MOO-499 is wanted.
- Plane's seven onboarding tutorial items are still in "Moody and Co", and
  `mkedev` shows on the board alongside it.

**Settled, do not raise again:** the Telegram token rotation; `.env.local`'s
missing variables (they are in Vercel, verify against production); Studio's
shadcn exception; Studio's text recall having no search index; Plane having no
mirror tables and no MCP server; AtomicMail (lost to AgentMail); Picovoice and
DaVoice (both lost to openWakeWord, for the reasons above).

## Tarik

They/them. Decisive, and dislikes re-litigation. Answers very short, so put the
recommended option first and make it unambiguous.

**Read the length of the question.** A one-word question wants a one-line
answer. He attaches "ultrathink" when he wants the long version, and those are
worth answering properly.

He pushes back accurately and it is usually a correction worth taking. Today he
asked whether Remote Control needs the laptop open, which exposed that the
answer about to be given was wrong; he pointed at DaVoice, which was worth the
hour it took to rule out properly; and he noticed the `hf-cli` skill, which
corrected a deprecated command he had already been handed.

Write in plain language. Lead with what he can do now.

## Suggested skills

- **`superpowers:test-driven-development`** — everything that landed cleanly
  went through it.
- **`superpowers:verification-before-completion`** — before any "done". It
  earned its place four separate times today.
- **`soundshuman:humanize`** for prose. Note its voice-calibration rule: a
  writing sample outranks its own style rules. Em dashes are gone from his
  writing by preference, so that is settled.
- **`ponytail`** — active throughout.

`npx next build` before saying done. Pushing `main` deploys everything.
