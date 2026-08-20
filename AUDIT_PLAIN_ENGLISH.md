# How Production-Ready Is jarvis (TarikOS / Zola)?

*A plain-English walkthrough — no jargon left untranslated.*

## The short version

The inside of this app is in genuinely good shape. Your secrets are clean, your
types are strict, you have 1,017 tests, and your logging and tracing are wired
up properly. What's missing is everything *around* the code: nothing checks your
work before it goes live, and nothing tells you what to do when it breaks. The
score looks harsh because of one gap — you have no automatic checker running
your tests before a change ships. Right now the only thing standing between a
broken commit and your live app is you remembering to type `npm test`.

**Score: 82/100 (D — High Risk, release blockers present)**

One honest note before the list. You told me a day of downtime is annoying but
nothing is lost for good, and that's true — Gmail, Convex and Plane all hold
their own copies. That correctly takes the scariest category off the table. But
this repo is **public**, and five scheduled jobs run every morning with nobody
watching. So the real risk here isn't lost data. It's shipping something broken
and not finding out for hours.

## What's already solid ✅

- **Your secrets are genuinely clean.** No passwords or API keys in your code,
  none in your `.gitignore` blind spots, and — I checked your entire git history,
  not just today's files — none ever committed, not once. For a public repo,
  that's the single most important thing to get right, and you got it right.
- **You test more than most professional teams.** 85 test files, 1,017 tests.
  And they're not decorative — yesterday's work proved that by deliberately
  breaking the code to confirm the tests would catch it.
- **The computer double-checks your work as you write.** TypeScript strict mode
  is on, which catches a whole category of bugs before the code ever runs.
- **You already have real logging and error tracking.** pino, OpenTelemetry, and
  Vercel's tracing are all installed and wired up. Most projects at this stage
  have `console.log` and hope.
- **AI assistants start every session with the right context.** `CLAUDE.md` and
  `AGENTS.md` exist and are actually maintained. That's why sessions like
  yesterday's don't waste an hour re-learning the codebase.
- **Your dependency list is frozen and reproducible.** `package-lock.json` is
  committed, so "works on my machine" reliably means "works in production."

## What needs attention, ranked by urgency

### Nothing checks your work before it goes live 🔴

**What we checked:** Whether there's an automatic checker that runs your tests
every time you push a change, before it can reach the live site.

**What we found:** There is no `.github/` folder at all. No automatic checker of
any kind. Your 1,017 tests only run when a human remembers to run them.

**Why it matters:** Yesterday you pushed straight to `main` four times, and every
push deployed to production automatically. The tests passed — because I ran them
by hand. If I hadn't, or if I'd missed one, the broken version would have gone
live and the 7am scheduled brief would have run against it. You'd have found out
from Zola saying something wrong, not from a red X.

**The concept, in one paragraph:** A CI pipeline (short for "continuous
integration") is a robot proofreader. Every time code is pushed, it installs
your project fresh, runs your tests, checks your types, and builds the app — on
a clean machine, not yours. If anything fails, it puts a red X on the change and
blocks it. The value isn't that it does something you can't do; it's that it
never forgets, never skips it because it's late, and never assumes "that change
was too small to break anything."

**How urgent is this really?** Fix this first. You already have the tests — this
is just plugging them in so they run without you. It's roughly 30 minutes of
work and it's the highest-value thing on this list by a wide margin.

---

### Rolling back a bad deploy only undoes half of it 🟠

**What we checked:** Whether there's a written procedure for undoing a bad
release across *every* place this app lives.

**What we found:** This app deploys to two separate places — Vercel (the website)
and Convex (the database and backend). Your `vercel.json` runs
`npx convex deploy --cmd 'npm run build'` on production builds, so one
`git push` ships both at once. But undoing it doesn't work the same way. Nothing
in your README or docs explains how to reverse that.

**Why it matters:** `vercel rollback` reverts the website code only. It does not
touch Convex. (You're on Vercel Pro, so you *can* roll back to any past
deployment — the limit isn't which version you can reach, it's that Convex
doesn't come with it.) So if you ship a bad change and roll back, you get yesterday's
website talking to today's backend — which may have a database shape it doesn't
recognize. That's not "back to normal," that's a new, weirder broken state, and
you'd be debugging it under pressure.

**The concept, in one paragraph:** When your app is split across two platforms,
each one has its own undo button and they aren't connected. A coordinated
rollback plan is just a written answer to three questions: which side do I undo
first, how do I check the other side still works with it, and what specifically
breaks if I only undo one. Writing it down once, calmly, is what stops you from
having to work it out at 7am while the morning brief is failing.

**How urgent is this really?** High, but it's a documentation job, not a coding
job. An hour with a text file. Do it before the next schema change, because
schema changes are exactly when you'd need it.

---

### There's no "break glass" page for when things go wrong 🟠

**What we checked:** Whether there's a runbook — a written checklist for what to
do when the app misbehaves.

**What we found:** No runbook, incident-response, or recovery doc anywhere in the
repo.

**Why it matters:** You have five scheduled jobs running unattended in
production, including the weekday morning brief. When one fails at 7am, the
things you'd need are: how do I see what happened, how do I re-run it, and how
do I turn it off if it keeps failing. Right now all of that lives in your head,
which is fine until it's 7am and you're not fully awake.

**The concept, in one paragraph:** A runbook is an emergency instruction sheet
written by calm-you for panicking-you. It doesn't need to be long or formal —
half a page of "if X is broken, check Y, then run Z" beats a beautiful document
that doesn't exist. The real value is that it forces you to notice which
recovery steps you've never actually tested.

**How urgent is this really?** High, and cheap. Half an hour. You already know
all the answers; this is just writing them down.

---

### If the app stops responding, nothing notices 🟡

**What we checked:** Whether there's a simple URL that reports "I'm alive and my
database connection works."

**What we found:** No `/health` or `/healthz` route exists.

**Why it matters:** If the app goes down at 2am, nothing finds out until you open
it. An uptime monitor needs a URL to poll, and there isn't one. Given you said a
day of downtime is annoying rather than damaging, this is about your own
convenience, not a crisis.

**The concept, in one paragraph:** A health check is a deliberately boring page
that does the smallest possible real work — confirms the app is running and can
reach its database — and says "OK." Automated monitors hit it every minute. The
trick is making it check something real; a health check that returns "OK" no
matter what is worse than none, because it tells you everything's fine while
the app is on fire.

**How urgent is this really?** Medium. Worth doing, not worth losing sleep over.
About 15 minutes, and it pairs naturally with a free uptime monitor.

---

### Nothing caps runaway API spending 🟡

**What we checked:** Whether any speed bump stops one caller from hammering your
endpoints thousands of times.

**What we found:** No rate limiting anywhere. Two files even have comments noting
there's nothing to rate-limit against.

**Why it matters:** Your tool routes call Anthropic and various research APIs —
these cost money per call. They're protected by a shared secret, so this isn't a
door standing open. But a bug in a retry loop, or a leaked secret, means a bill
rather than an outage. Your public document-sharing route (`/f/[slug]`) has no
secret at all, though it only reads a document, so the cost there is low.

**The concept, in one paragraph:** Rate limiting is a speed bump: "this caller
gets 20 requests a minute, then waits." Its real job usually isn't blocking
attackers — it's containing your own bugs. An infinite loop that calls a paid AI
API is a genuinely expensive mistake, and a rate limit turns it from a bill into
an error message.

**How urgent is this really?** Medium. Your secret is doing most of the work
already. Worth adding on the money-spending routes specifically, not everywhere.

---

### New environments need a guessing game 🟡

**What we checked:** Whether there's a safe-to-share list of which settings the
app needs.

**What we found:** No `.env.example`. Your real `.env.local` has 28 different
settings in it.

**Why it matters:** This is a public MIT repo. Anyone who clones it — including
you on a new laptop — has no way to know which 28 values to provide. They'd have
to read the source and reverse-engineer it.

**The concept, in one paragraph:** An `.env.example` is a packing list without
the passport number filled in. It names every setting the app needs, with blank
or fake values, and it's safe to commit because it contains no real secrets.
It's the difference between "here's my project" and "here's my project and how
to actually run it."

**How urgent is this really?** Medium, and it's a five-minute job. It matters
more than usual here only because the repo is public and portfolio-facing.

---

### Dependency security updates arrive only if you look 🟢

**What we checked:** Whether a robot watches your dependencies for known security
holes and whether anything scans for them automatically.

**What we found:** No Dependabot or Renovate config, and no vulnerability scan.

**Why it matters:** Security fixes in your dependencies pile up silently. Nothing
is on fire — this is maintenance drift, and it's the normal state of most
projects.

**The concept, in one paragraph:** Dependabot is a robot that watches the
security advisories for every package you use and opens a pull request when one
needs patching. Turning it on is a single small file, and then it does the
watching forever.

**How urgent is this really?** Low. Genuinely a nice-to-have. Do it when you set
up CI, since they live in the same folder.

---

### One finding I checked and disagree with 🟢

The tool flagged **"no test runner configured"** and **"no coverage tracking."**
The first one is misleading and I'm overruling it: you *do* have a test runner —
Node's built-in one, via `node --test "tests/*.test.ts"` — the tool just looked
for a `jest.config.js` and didn't find one. Nothing to fix.

Coverage tracking is a fair catch, but it's low value here. Coverage tells you
which code nothing tests. With 1,017 tests that you actively mutation-check,
you're already ahead of what a coverage number would teach you.

---

## Your next-lesson roadmap

1. **Add your first CI pipeline** (~30 min). One file, `.github/workflows/ci.yml`.
   You'll reuse this exact pattern on every project you build from here on.
2. **Turn on branch protection** (~5 min). Because your repo is public, GitHub
   gives you this free. It makes the robot proofreader's red X actually *block*
   a merge instead of just complaining.
3. **Write the two-surface rollback procedure** (~1 hr). The most valuable
   writing on this list — it's the one thing that turns a bad deploy from a
   panic into a checklist.
4. **Write a short runbook** (~30 min). Start with just the morning brief: how
   to see it failed, how to re-run it, how to turn it off.
5. **Add a health check and point a free uptime monitor at it** (~15 min).
6. **Commit an `.env.example` and switch on Dependabot** (~15 min together).

Items 1 and 2 are the ones that change your daily life. The rest are insurance.

---

*This audit was generated by a static-analysis tool — it reads your code and
config files, it doesn't run your app. I hand-verified the secrets findings
against your full git history, and overruled one finding the tool got wrong
(see above). Full technical findings with file-level evidence and best-practice
citations are in the companion report.*
