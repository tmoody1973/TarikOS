# Handoff — Tarik OS, 2026-08-11

Three threads today: **contacts** (MOO-499, the big one), the **morning brief on
Telegram**, and two **eval harness** fixes that should have been one.

Everything that fits in a ticket is in one. This carries what does not: the
traps, the corrections, and the things that will mislead you if you trust a
document over the code.

**Read first**
- [MOO-499](https://linear.app/moodyco/issue/MOO-499) — In Progress, three long comments recording every design decision and what disproved the first version of each.
- The commit messages. They carry the reasoning; do not re-derive it.
- The previous handoff's traps still apply. They are not repeated here.

## State

`main` in sync with origin. **567/567 tests, tsc and eslint clean.** Everything
below is deployed to production and exercised there, not just in tests.

Working tree carries only `.claude/`, which is not mine to decide on.

## What is live

**Contacts.** 4,825 from Google, synced daily at 09:00 UTC. `find_contact` and
`add_contact` on voice and text; `/contacts` (PEOPLE, salmon) for search and
cards. Reads ride the **existing Gmail connection**; writes use a separate
`googlecontacts` connection Tarik authorised today.

**Morning brief on Telegram.** The 7am cron already built a brief and wrote it
to the dashboard; it now also arrives on their phone. Off switch is the
`send_brief_digest` toggle in the control panel — no deploy needed.

**Evals.** The noise bar is honest (per-row flips, not aggregate range) and a
3-run pass takes 3 minutes instead of 35.

## The lesson that matters more than any trap

**I spent three commits on the eval harness before Tarik asked "are we ever
going to start working on new features."** They were right. Nothing in those three
commits changed anything they could use. I picked the well-specified ticket over
the valuable one, and then explained it twice when they had already said they did
not care.

The measuring instrument is not the product. When they say "what's next," the
answer should be something they can *feel*, not something that makes a number
more accurate.

They also asked me to "pretend I'm a teenager." **Write plainly.** No jargon, no
implementation nouns they never asked about.

## Traps — every one of these cost real time today

- **The Convex `tools` table has NO last-success timestamp.** Only
  name/description/enabled/health/lastError. Column 2 of `convex data tools` is
  `_creationTime` — set once, never updated. I read it as "when did this last
  run", concluded a working feature was broken, and spent twenty minutes on it.
  **There is no server-side signal that a tool call succeeded.** To confirm a
  notification actually arrived, ask Tarik.
- **`npx convex codegen` generates types; it does not deploy.** A route calling
  a new Convex function will typecheck and then fail at runtime with "Could not
  find public function". `npx convex dev --once` for dev, `npx convex deploy`
  for prod.
- **`convex logs` tails; `--history` does not replay.** If your code only logs
  on failure, silence is evidence of success — but you cannot go back and look.
- **Vercel sensitive env vars really cannot be pulled back.** `vercel env pull`
  returns the literal string `"[SENSITIVE]"` for every one. Do not plan a
  recovery around it.
- **`.env.local` dropped lines again — third time.** It went 54 → 44 on one
  hand-edit and took `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`,
  `SHARE_BASE_URL` and two `R2_*` vars with it. Check `wc -l` after any edit.
- **The dev server dies between commands.** Check `lsof -ti tcp:3005`, and
  identify a port by the process's working directory (`lsof -a -p <pid> -d cwd`),
  never by the page title — 3000 is `pm-portfolio`.
- **A screenshot is not a measurement.** The CALL button on `/contacts` looked
  clipped; `document.documentElement.scrollWidth === window.innerWidth` proved
  the page was fine and the capture was cropped.
- **Chrome would not resize below ~1263px**, so the mobile layout of
  `/contacts` is unverified visually. It rests on the class contract in tests.

## Composio, specifically

- **Check `composio_managed_auth_schemes` before assuming a toolkit is usable.**
  `GET /api/v3/toolkits/<slug>`. `gmail` and `googlecalendar` return
  `["OAUTH2"]`; `googlecontacts` returns `[]`, meaning bring-your-own OAuth app.
  Composio's dashboard only shows this by demanding a Client ID.
- **The proxy is the escape hatch.**
  `POST /api/v3.1/tools/execute/proxy` makes arbitrary API calls with
  credentials Composio already holds — which is how Google contacts are read
  through the Gmail connection, whose grant already carried `contacts.readonly`.
  **Check what an existing connection was actually granted before building a
  new one.**
- **API keys are scoped per route.** The default key has read on
  `auth_configs` and *none* on `proxy_execute`. `COMPOSIO_PROXY_API_KEY` is a
  second key with proxy write.

## Corrections I had to make out loud

Each of these I stated confidently and was wrong about.

- **"The workflow path did not fire."** I was reading an immutable column. There
  was no failure. Verify that your instrument can move before trusting it.
- **"This is the Workspace admin block."** Google's "This app is blocked — tried
  to access sensitive info" was the **OAuth consent screen Test users list**. I
  had named that possibility, then talked myself past it because the wording
  sounded like the admin restriction. Tarik fixed it in a minute.
- **"No Google Cloud project needed."** True for reading, false for writing. I
  generalised from the Gmail and Calendar configs being Composio-managed.
- **"A labelled phone number is speculative."** I rejected any number containing
  a letter. The real address book had `(414) 555-1234 (IDP)` — a valid number
  thrown away. Trailing labels are stripped now.

## What only real data found

Three bugs that no fixture would have produced, all from running against the
real 4,825:

- **`contactKey` keyed on the first phone collapsed two people who share a
  household landline** — the exact pair `compatibleNames` was written to keep
  apart, colliding one layer further down. The first sync wrote 4,823 rows for
  4,825 people. Key on the provider id.
- **"Reachable" is not "a person."** 4,033 of 4,825 have no phone and no email,
  and most of the remaining 792 are addresses Gmail collected from senders.
  Sorted by name, `/contacts` opened on `02 Asana - Mobile App Tasks`. Nothing
  auto-collects a phone number, so phone-holders sort first.
- **The `(IDP)` number above.**

**The mutation sweep found weak tests seven times today**, and reading found
none of them. The recurring shape: a test that passes for a reason other than
the one you intended. A single-word query cannot tell `every()` from `some()`.
A uniform-filler truncation test passes a naive `.slice()`. Asserting a timing
array's length and ordering passes when every row gets the same timing. Always
ask what *else* would make this assertion pass.

## Known gaps, deliberately left

**Contacts**
- iCloud CardDAV sync unbuilt — needs an app-specific password.
- No dashboard tile. `contacts.stats` exists; nothing renders it.
- `/contacts` mobile layout never seen at 375px.
- Full pull every sync rather than incremental `syncToken`. Deliberate: a full pull
  cannot drift, and 20 seconds a day does not justify tombstone handling.
- Writing is create-only. No edit, no delete, no iCloud writes.

**Evals**
- The bar is ±4.0% on 107 labels. Nothing smaller is provable. **MOO-578**
  (grow the label set) is the only thing that moves it; the band shrinks as
  `1/n`.
- A row came back `__truncated__` at `MAX_TOKENS=4096`, and `report()` only
  inspects the last run, so a truncation in an earlier repeat goes unwarned.

**Telegram**
- Morning brief digest ships; the weekly review deliberately does not
  (`DIGEST_WORKFLOWS` in `convex/workflowRunner.ts` is the whole policy).

## Open, needs Tarik

- **iCloud app-specific password**, if the iCloud half of MOO-499 is wanted.
- **`/contacts` on a phone** — the one check I could not run.
- **MOO-529** — thirty seconds in airplane mode. Open since two handoffs ago.
- **The Telnyx number** (+1 414 635 2386) serves `call_tarik` only and still
  costs money. Keep or drop.
- **Studio §15.3** — unresolved since before yesterday.

**Settled, do not raise again:**

- The Telegram bot token rotation. It was pasted into a transcript; rotation was
  proposed and Tarik declined.
- **`.env.local`.** It is missing ten variables the Next code reads, not the
  five recorded earlier. All ten are present in Vercel production — verified by
  name, not assumed. Tarik ships straight to production and does not run `next
  dev`, so this breaks nothing they use, and Vercel will not return a sensitive
  value to restore them with. Do not carry it as open, and verify features
  against production instead: create a throwaway record, exercise the tool,
  delete it.

## Tarik

They/them. Decisive — picks and moves, dislikes re-litigation. Answers very
short, so put the recommended option first and make it unambiguous.

Write in plain language. They asked for it explicitly today. Lead with what they can
do now, not with what you built.

They push back accurately. Every push today was right: the eval detour, the
"didn't you do this via cli" that exposed I had over-complicated the auth story,
and the test-users fix I had talked myself out of.

## Suggested skills

- **`superpowers:test-driven-development`** — test → RED → implement → GREEN →
  mutation sweep. Every guard that survived today went through it.
- **`superpowers:verification-before-completion`** — before any "done".
- **`ponytail`** — active all day.

Do **not** reach for the PAI ALGORITHM ceremony for a single scoped commit.
Everything that landed cleanly today was TDD with a mutation sweep on top, and
then run against real data — which is where the three real bugs came from.
