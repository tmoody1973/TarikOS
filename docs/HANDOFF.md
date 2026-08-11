# Handoff — Tarik OS, evening of 2026-08-10

Two threads finished today: **Phase 5, Documents & Sharing** (closed) and
**text-message Zola**, which turned out not to be SMS.

Everything that fits in a ticket is in one. This carries what does not: the
traps, the corrections, and the things that will mislead you if you trust a
document over the code.

**Read first**
- [MOO-497](https://linear.app/moodyco/issue/MOO-497) — re-scoped and closed. Why SMS was abandoned, what replaced it, and what is left open.
- [Tarik OS Phase 5](https://linear.app/moodyco/project/tarik-os-phase-5-documents-and-sharing-47637633817c) — completed, with a closing comment recording both places the design was wrong.
- The commit messages. They carry the reasoning; do not re-derive it.

## State

`main` in sync with origin. **420/420 tests, tsc and eslint clean.** Everything
below is deployed to production and exercised there, not just in tests.

Working tree carries only `.claude/`, which is not mine to decide on.

## What is live

**Documents & sharing.** Save a brief, research result or journal digest as
markdown in R2 (`tarikos-documents`); share it behind a two-call server-side
confirm gate; serve it at `/f/<slug>` with no Clerk session; revoke it; see
every live link at `/documents`. Voice-verified — Tarik saved and shared a
brief by speaking.

**Telegram.** [@tarikos_zola_bot](https://t.me/tarikos_zola_bot). Text her and
she answers, with 14 tools, HTML formatting, and memory of the conversation. A
stalled browse session messages him instead of phoning him. `send_telegram`
lets voice-Zola put something in writing. Agent provisioned: **30 tools**.

## Traps — every one of these cost real time today

- **A bare `<` rejects an entire Telegram message.** Not the tag — the
  character. "5 < 7" in ordinary prose returns `can't parse entities` and
  Telegram sends *nothing*, so the bot appears to go silent at random. The send
  path falls back to plain text; `escapeHtml` runs on anything the app did not
  author. Verified by probing the live API because the formatting doc would not
  fetch.
- **Guard tests that name the guard in a comment pass while guarding nothing.**
  This bit three times. `!/reportToolError/` matched my own comment explaining
  what the guard prevented; a proxy-route test matched the word "document" in
  the prose above the route list. Strip comments before scanning for code.
- **Asserting that a check is *mentioned* is not asserting that it *guards*.**
  `if (false && !secretMatches(...))` passed a test that checked ordering of
  mentions. Pin the guard's shape, not its presence.
- **Slicing a fixed number of characters reads into the next thing.** A missing
  `x-morpheus-secret` header passed because the 2400-char window reached the
  *following* tool's entry. Bound slices on real boundaries.
- **`convex data` has no guaranteed order.** `tail -1` to get "the row I just
  wrote" returned a different one, and minted a share link to an object that
  had never been uploaded. Match on the key you wrote.
- **Four of the weak assertions above were found by the mutation sweep and none
  by reading.** The sweep is not ceremony. Baseline must be green first — a
  mutation "caught" by an already-red suite is not evidence.
- **`next build` cannot run while `next dev` holds the same `.next`.** And
  before diagnosing a stale dev server, check `lsof` for which project owns the
  port — port 3000 here is `pm-portfolio`, not this repo.
- **Do not run `git stash` in a repo another session is working in.** I did,
  swallowed Tarik's uncommitted work for a minute, and got it back only by
  luck. Two dev servers on 3000/3001 were the tell, and I did not read it.

## Corrections I had to make out loud

Each of these I stated confidently and was wrong about. They are here because
the pattern matters more than the facts.

- **"Nothing pending in Tarik OS."** I had looked at one Linear *project*. The
  Tarik OS backlog is fifteen unlabelled issues in the Moodyco team — SMS,
  contacts, Granola, Plane, Retool, restaurants, five habits bugs, five evals
  issues. Closing a project does not empty a backlog.
- **Port 3000 is "a stale build of this app."** It is a different project. I
  inferred it from a page title instead of checking the process.
- **"MOO-587 needs nothing from you."** Its own handoff lists it as blocked on
  Clerk keys. (They were actually already in `.env.local` — that handoff was
  stale too. Verify both directions.)
- **"STOP/HELP is twenty minutes of code."** It is configuration; Telnyx
  handles opt-out keywords on the messaging profile.
- **A Cloudflare menu path, and a Telnyx one, both from memory.** Both wrong.
  Fetch the docs or use the API.

## Known gaps, deliberately left

**Documents**
- `save_document` cannot pick a brief by id — "that one" always means the
  newest ready brief, silently. `workflows.getBrief` needs a Clerk session, so
  the tool route cannot reach it; it needs a secret-gated query.
- No ad hoc saves: `sourceType` allows only `brief | research | journal_digest`.
- No PDF rendering (design open question 1).
- `/documents` hardcodes a 7-day expiry. The voice path honours
  `expires_in_days` and the spoken word "never"; the page does not.

**Telegram**
- Nine tools withheld from text, reasons in `src/lib/textTools.ts`. The blocker
  is a confirm ritual that works over a channel with no spoken yes.
- Morning brief digest: designed, unbuilt. It needs an off switch — an unwanted
  brief on a phone every morning is worse than none.
- `textTools.ts` duplicates tool names because `provision-agent.ts` throws at
  import without `TOOL_BASE_URL`. `tests/textTools.test.ts` is the only thing
  stopping the two lists drifting.

## Open, needs Tarik

- **MOO-529** — thirty seconds in airplane mode: reload, confirm the shell
  returns with no stale data. Open since the last handoff.
- ~~Rotate the Telegram bot token.~~ **Raised and declined by Tarik (2026-08-11).**
  It was pasted into a session transcript; they have decided not to rotate.
  Do not raise it again.
- **The Telnyx number** (+1 414 635 2386) now serves `call_tarik` only and
  still costs money. Keep or drop.
- **Studio §15.3** — does Studio v1 own new briefs or link to existing Brief
  records. Unresolved since before today; it will bite when Studio is scoped.
- **`pm-portfolio` has uncommitted MOO-587 work** — Clerk auth, six new files,
  tests passing, build diff clean. Tarik was working in that repo in another
  session; nothing was committed.

## Tarik

They/them. Decisive — picks and moves, dislikes re-litigation. Answers very
short, so put the recommended option first and make it unambiguous.

**Two things I got wrong about working with them today.** They approved
"MOO-587" without realising it was a different repository, because I mentioned
that in one line and kept going — when an option changes project, say so
loudly. And when they ask "what is next", check the whole backlog, not the
thing you were just looking at.

They push back accurately when something is off ("what do you mean nothing
pending", "why did you switch"). Those pushes were right every time.

## Suggested skills

- **`superpowers:test-driven-development`** — test → RED → implement → GREEN →
  mutation sweep. Every guard that survived today went through it.
- **`superpowers:verification-before-completion`** — before any "done".
- **`ponytail`** — active all day; the ladder is why `checkShareAccess` has one
  implementation instead of two.

Do **not** reach for the PAI ALGORITHM ceremony for a single scoped commit.
Everything that landed cleanly today was TDD with a mutation sweep on top.
