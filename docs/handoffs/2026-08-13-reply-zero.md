# Handoff: `reply_zero`

**Written** 2026-08-13 evening, from a context window that had just shipped the
brief lede. Everything below was verified by reading the files, not recalled.

**Read this and you can build it without re-deriving anything.**

---

## What we are building, in one sentence

A tool that finds the threads where somebody wrote to Tarik and he never
answered, so the morning brief can say *"the Valeria email is still sitting, two
days now"* without him having to go looking.

## Why, and why not the obvious alternative

Tarik asked about [elie222/inbox-zero](https://github.com/elie222/inbox-zero),
12k stars, an AI email assistant. Its **Reply Zero** feature is the good idea:
track threads awaiting a reply in either direction.

**We are not adopting it. Two hard reasons, both verified:**

1. **The licence is AGPL-3.0 with additional terms.** GitHub's API reports
   `NOASSERTION`; the LICENSE file itself is AGPL plus a commercial-monetisation
   restriction and an enterprise clause at five or more users. TarikOS is public
   and MIT. Borrowing code would relicense the repo. **Do not copy a line of
   it.** Reading it for ideas is fine.
2. **It is a full application, not a library.** Next.js, Postgres, Prisma,
   Redis, its own OAuth, its own UI. Running it means a second inbox competing
   with `/mail` and a second place email state lives, which collides with the
   rule already written into the projects board: *a copy is a thing that can
   disagree.*

So: build one small tool of our own, MIT, in the codebase that already has the
Gmail connection.

## The gap it fills

Her five mail tools are `get_emails`, `draft_email`, `draft_reply`,
`email_tarik`, `check_zola_mail` (verified in `scripts/provision-agent.ts`).
Every one of them **reads or drafts**. Nothing triages. Nothing notices a thread
he left hanging. The only filter is a mute list.

---

## What already exists that you will build on

All line numbers verified 2026-08-13.

| Thing | Where | What it gives you |
|---|---|---|
| `listMailThreads(accountLabel?)` | `src/lib/mail.ts:58` | Composio `GMAIL_FETCH_EMAILS`, query `in:inbox newer_than:7d`, 25 per account. Returns `MailThreadRow[]` **deduped to the newest message per thread**, newest first, plus the account labels. |
| `MailThreadRow` | `src/lib/mail.ts:15` | `{ threadId, account, from, subject, snippet, date }` |
| `getRecentEmails(mutes)` | `src/lib/google.ts:286` | What `get_emails` uses. Same Composio action, mute-filtered query, 6 per account. |
| `buildInboxQuery(mutes)` | `src/lib/google.ts` | Builds the muted Gmail query. Reuse it so reply_zero honours the mute list too. |
| `getMailThread` | `src/lib/mail.ts:424` | One thread in full, if you need per-thread message lists. |
| `matchThread` | `src/lib/mail.ts:112` | Strict subject+sender matching. Its comment is the house rule: *"A wrong match drafts into the wrong conversation, so none/ambiguous always beats a guess."* |
| Mute list | `api.mailFilters.forTools` | Convex query, already used by `get_emails`. |

**`sendDraft` exists at `src/lib/mail.ts:416` and that is fine.** Its only
caller is `src/app/api/mail/drafts/[id]/send/route.ts`, which is Tarik pressing
Send on his Mail page. **No tool reaches it, and reply_zero must not change
that.** Grep before you finish: `grep -rn sendDraft src/` should still show
exactly one caller outside the lib.

---

## The design

### One new pure library, one new tool, one seed line

**1. `src/lib/replyZero.ts`** — pure, no network, no Composio import, so
`node --test` can reach it directly. This is the same split
`src/lib/lede.ts` and `src/lib/zolaReply.ts` use, and it is not optional: the
tests import the file.

It holds the rules:
- who counts as "him" (his own addresses, so a thread he answered last is not
  awaiting him)
- how old a thread must be before it counts as *sitting* rather than *recent*
- how the result is phrased for speech

**2. A `reply_zero` case** in `src/app/api/tools/[tool]/route.ts` that calls
`listMailThreads`, applies the pure rules, and returns `{ ok, message, data }`.

**3. One line in `MORNING_BRIEF_STEPS`** in `convex/workflows.ts` (~line 300),
then re-run the seed.

### Why point 3 is the whole trick

Workflow steps are **data in the Convex `workflows` table**, shaped
`{ tool, args }`. The runner walks them and `formatSection` turns each result
into a brief section. **And the lede writer reads every section.**

So adding `{ tool: "reply_zero", args: {} }` to the morning brief's steps means
the lede starts writing sentences like *"the Valeria email is still sitting, two
days now"* **with no new plumbing at all.** The lede already reads the previous
brief's own lede, so persistence across days comes free too.

That is the argument for doing this next: it is one tool, and the feature that
makes it valuable already shipped this morning.

---

## The open question you have to answer first

**`in:inbox` excludes sent mail.** `listMailThreads` queries
`in:inbox newer_than:7d`, so the newest message it sees for any thread is
always one Tarik *received*. That means:

- **"They wrote last"** is easy, and it is most of the value.
- **"I already replied"** is invisible. If he answered from his phone, the
  thread still looks like it is awaiting him. **This is the accuracy problem to
  solve, and it decides whether the tool is trusted or ignored.**
- **"I am waiting on them"** — the other half of Reply Zero — cannot be seen at
  all from this query.

Three ways out, cheapest first:

1. **Query `in:inbox -from:me newer_than:7d` and accept the false positives.**
   Simplest. Still wrong when he replied elsewhere.
2. **Per-thread check with `getMailThread`.** Accurate. Costs one API call per
   candidate thread, so cap the candidates hard.
3. **Two queries and a join** — `in:inbox` and `in:sent`, compare newest
   timestamp per `threadId`. One extra call per account, no per-thread cost, and
   it gives you *both* directions of Reply Zero.

**Option 3 is probably right.** Do not just take my word for it; the Composio
`GMAIL_FETCH_EMAILS` response shape needs checking against a real call before
you commit, because it is the thing that decides the whole design.

---

## How to add a tool here (the repeatable pattern)

From `AGENTS.md`, and it is accurate:

1. **Route:** add `case "reply_zero"` to `src/app/api/tools/[tool]/route.ts`.
   Read args from `body` with `strArg`, do the work, return
   `{ ok, message, data? }`. `message` is what Zola speaks.
2. **Agent:** add the definition to `TOOLS` in `scripts/provision-agent.ts`
   (name, spoken-purpose description, JSON body schema, `x-morpheus-secret`
   header), then run `node scripts/provision-agent.ts`.
3. **Registry:** nothing to do. It auto-registers in the Convex `tools` table on
   its first successful call via `markToolHealthyFromTool`, then appears in the
   control panel with a toggle and a health dot.

---

## Traps, learned the hard way this week

- **A test that cannot fail is worse than no test.** Five shipped in the lede
  work, every one caught in review. The fix that works: **mutate the source the
  test claims to protect, watch it fail, restore it, watch it pass.** If it
  passes under both spellings it is decorative. Make that the acceptance
  criterion, not a suggestion.
- **`--prod` on every Convex CLI call.** Dev is a different deployment and an
  empty table there produces a confident wrong diagnosis.
- **Read the agent back off the live API after provisioning.** The script prints
  "Updated agent" whether or not anything landed.
- **The eval baseline is taken BEFORE any description changes**, with
  `evals/.venv/bin/python evals/replay.py --save before`. The system `python3`
  lacks the `anthropic` module. Current baseline: **72.0%**, noise floor ~9%, so
  a two-point move is nothing. Three runs, not one.
- **A tool description is not scoped to a trigger.** Anything written there
  applies to every call. That is how "read the paragraph and stop" nearly killed
  the Sunday telos walk.

---

## Definition of done

- [ ] `src/lib/replyZero.ts`, pure, with tests that were mutation-verified
- [ ] `case "reply_zero"` returning a spoken sentence and structured data
- [ ] Honours the mute list, the way `get_emails` does
- [ ] Published in `provision-agent.ts`, agent provisioned, **read back off the
      live API**
- [ ] `{ tool: "reply_zero", args: {} }` added to `MORNING_BRIEF_STEPS`, seed
      re-run, and a real brief built in production whose **lede mentions a
      sitting thread**
- [ ] `grep -rn sendDraft src/` still shows one caller outside the lib
- [ ] `npm test` green (980 as of this handoff), `npx tsc --noEmit` clean,
      `npx next build` green
- [ ] Eval taken before and after, three runs each

## Scope this does NOT include

Archiving, labelling, unsubscribing, or anything that writes to Gmail. Those are
inbox-zero's other features and they are a separate decision. Archiving is
recoverable and would be the one to consider first; anything that deletes what
he cannot get back is against the standing rule.

## Where the current state is

`docs/HANDOFF.md` is the running one. The lede shipped this morning: design in
`docs/superpowers/specs/2026-08-13-brief-lede-design.md`, plan and full review
trail in `docs/superpowers/plans/2026-08-13-brief-lede.md`.
