# Fix Brief: jarvis (TarikOS / Zola)

Paste this into Claude Code inside this repo. **This brief is split into phases
by severity — do not start Phase 2 until every Phase 1 acceptance criterion is
checked off and you've re-run the audit to confirm it. Same gate between every
later phase.** This isn't just pacing: adding CI in Phase 1 changes how you
verify the Phase 2 fixes, so skipping ahead means testing against a moving
target.

## Before you start

This repo is a Next.js app on Vercel with a Convex backend — TypeScript
throughout, npm, and Node's built-in test runner. It already has 1,017 tests and
strict type checking, so most of what follows is wiring existing quality checks
into automation, not writing new quality checks.

Because this app deploys to **both Vercel and Convex from a single push**
(`vercel.json` runs `npx convex deploy --cmd 'npm run build'` on production), the
rollback fix below accounts for the fact that `vercel rollback` does not roll
back Convex. That's the single most important stack-specific detail here.

It's fine — encouraged — to ask Claude Code to explain any step before running
it. That's how you learn what it's doing instead of trusting it blindly.

---

## Phase 1: Release Blockers 🔴

**Acceptance criteria for this phase — all must be true before moving on:**
- [x] `python3 ~/.claude/skills/prod-readiness-coach/scripts/prod_audit.py --repo . --json /tmp/audit.json` shows zero remaining `critical` findings — *CI/CD category 40 → 100, overall 82 → 90, grade D → A*
- [x] A push to a branch produces a visible pass/fail check on GitHub within a few minutes — *PR #1, run 32376883025, all 5 steps green*
- [x] A deliberately broken test causes that check to go red (verified once, then reverted) — *run 32377279111 failed on Tests, build skipped; reverted in ff517b4, green again*

**Status: PHASE 1 COMPLETE (2026-08-20).** All three acceptance criteria met,
`--fail-on critical` exits 0, and branch protection was explicitly deferred with
sign-off (reasoning recorded in the gate below). Merged to `main` in e73d9e7; CI is green on
`main` (run 32378692680) and the production deploy that merge triggered is Ready.

**Gate — do not proceed to Phase 2 until:**
1. Every checkbox above is true.
2. You've re-run `python3 ~/.claude/skills/prod-readiness-coach/scripts/prod_audit.py --repo . --fail-on critical` and it exits 0. — *done, exits 0*
3. The branch-protection item on the "Manual steps for a human" list has been
   done or explicitly deferred with sign-off — do not report this phase complete
   while silently skipping it. — *DEFERRED 2026-08-20 with Tarik's sign-off.*

   Reasoning, so future-you knows this was a decision and not an oversight:
   branch protection exists mainly to stop a second person merging something
   bad. This is a solo repo, and requiring a PR for every one-line change would
   tax the fast push-to-main workflow that actually works here. CI already
   delivers most of the value — a break surfaces within ~3 minutes instead of
   never — and Vercel Pro can roll back to any past deployment in about a
   minute. The accepted cost is real: CI on `main` runs *after* the deploy, so
   it's a smoke alarm, not a lock.

   **Revisit when either happens:** (a) anyone other than Tarik commits to this
   public MIT repo, or (b) a bad deploy actually causes real pain. Also fix the
   red Vercel preview check first — turning protection on while a check is
   permanently red trains you to ignore checks.

## 1. Nothing runs your tests before code ships 🔴 Fix this first

**In plain English:** You have 1,017 tests and nothing runs them automatically.
Every push to `main` deploys to production immediately, so a broken commit goes
live and the 7am scheduled brief runs against it.

**What to ask Claude Code to do:**

> Create `.github/workflows/ci.yml`. It should trigger on `pull_request` and on
> `push` to `main`. Single job on `ubuntu-latest` using
> `actions/setup-node@v4` with `node-version: 24` and `cache: 'npm'`. Steps, in
> order: `npm ci`, then `npx tsc --noEmit`, then `npm test`, then
> `npx next build`. Do not add a deploy step — Vercel already deploys from its
> own git integration, and duplicating it here would cause double deploys.
>
> **Pin the Node version deliberately — this repo has no `engines` field and no
> `.nvmrc`, so nothing currently declares one.** It matters more than usual here:
> `npm test` runs `node --test "tests/*.test.ts"`, executing TypeScript files
> directly, which relies on Node's built-in type stripping. That is not reliable
> on older Node 22 releases. Use 24 (the current LTS and Vercel's default). While
> you're there, consider adding `"engines": { "node": ">=24" }` to `package.json`
> so local, CI, and Vercel can't silently drift apart.
>
> The build step needs env vars that aren't available in CI. Check whether
> `npx next build` succeeds without them first; if it fails, add only the
> minimum placeholder values as `env:` on that step, and never real secrets —
> read `.env.local` for the variable *names* only.
>
> Verify by pushing to a branch and confirming the check appears and passes on
> GitHub.

**What you'll learn from this fix:** This is your first CI pipeline. The pattern
— install, typecheck, test, build, on every push — is identical on every project
you'll ever build. Once you've written it once, you'll copy it forever.

**How to know it worked:** Push a branch. A yellow dot appears next to your
commit on GitHub, then turns into a green checkmark. Then deliberately break one
test, push, and watch it turn red — that red X is the whole point. Revert it.

---

### Found while doing Phase 1: Vercel preview builds fail

Not part of any phase above — this surfaced because PR #1 was the first pull
request this repo has ever had, so Vercel had never built a preview before.

Every preview build fails with `Client created with undefined deployment
address` at `src/app/api/mail/drafts/route.ts:7`. The cause: `vercel.json` only
runs `npx convex deploy` when `VERCEL_ENV = production`, and that command is what
sets `NEXT_PUBLIC_CONVEX_URL`. Preview builds run plain `npm run build` with that
variable unset.

This matters now in a way it didn't yesterday: every future PR will show a red
Vercel check next to the green CI check, and a red check you're supposed to
ignore is exactly what trains you to ignore the real one.

**FIXED 2026-08-20.** Added two Preview-scoped env vars in Vercel:
`NEXT_PUBLIC_CONVEX_URL` pointed at the **dev** Convex deployment
(`necessary-monitor-400`), never production, so a preview build can't reach
production data; and a placeholder `COMPOSIO_API_KEY`, because the build only
needs the value to exist and a placeholder means a preview can't spend real
credits. Production env vars were not touched. Verified on PR #2: the preview
deploy went Error → Ready.

The more robust fix is still available and still worth doing someday: make the
Convex client lazy in the affected routes so it isn't constructed at module
load, the pattern `src/lib/google.ts` already uses and explains. That would
remove the build-time dependency entirely instead of satisfying it.

---

### Found while doing Phase 1: GitGuardian never reports

PR #1 and PR #2 both surfaced a `GitGuardian Security Checks` entry that sits at
`pending` and never resolves — still pending 10+ minutes after the other checks
finished. The GitHub App is installed on the repo but appears not to be
completing its run.

Two reasons this matters more than a stuck spinner:

1. **It looks like protection that isn't there.** A pending secret-scanning
   check reads, at a glance, like secret scanning is covered. It isn't. (The
   audit's own secret findings were verified by hand instead — no `.env` ever
   committed, no key patterns anywhere in git history.)
2. **It would deadlock branch protection.** If branch protection is ever turned
   on with "require all checks to pass," a check that never reports blocks every
   merge, permanently. Fix or uninstall GitGuardian *before* enabling protection.

**A human should do this:** open the GitGuardian dashboard and either finish
connecting it or remove the app from the repo. Both are account-level actions.

---

## Phase 2: Serious Gaps 🟠

**Acceptance criteria for this phase — all must be true before moving on:**
- [ ] The audit shows zero remaining `high` findings
- [ ] A written rollback procedure names both Vercel and Convex and states which one is undone first
- [ ] A runbook exists that covers at least the weekday morning brief failing

**Gate — do not proceed to Phase 3 until:**
1. Every checkbox above is true.
2. `... prod_audit.py --repo . --fail-on high` exits 0.
3. The rollback doc states plainly that this project is on Vercel Pro, so
   `vercel rollback` can target any past production deployment.

## 2. Rolling back only undoes the website, not the backend 🟠

**In plain English:** One `git push` deploys both Vercel and Convex. But
`vercel rollback` reverts only the website code. Convex stays on the new
version, so you end up with an old frontend talking to a new backend.

**What to ask Claude Code to do:**

> Create `docs/runbooks/rollback.md`. It must be specific to this repo's two
> surfaces, not generic. Cover:
>
> 1. **What one push actually deploys.** Quote the `buildCommand` from
>    `vercel.json` verbatim and explain that production builds run
>    `npx convex deploy` before `npm run build`, so both surfaces move together.
> 2. **What `vercel rollback` does and does not cover.** This project is on
>    Vercel **Pro** ($20/month), so rollback can target **any** past production
>    deployment, not just the immediately previous one — write the command as
>    `vercel rollback <deployment-url>` and say so explicitly, because the Hobby
>    limitation does not apply here. It reverts application
>    code only, at the routing layer, without a rebuild — roughly 60 seconds. It
>    does NOT revert Convex functions or schema. It also does NOT refresh
>    environment variables: a rolled-back deployment runs with the env vars baked
>    in at its *original* build time, so if a secret was rotated since, the
>    rolled-back version is using the old value.
> 3. **The decision table.** Three rows: code-only change (roll back Vercel,
>    Convex is unaffected); Convex function change with no schema change (redeploy
>    the previous commit rather than rolling back, since Convex has no direct
>    rollback command); schema change (do NOT roll back — roll *forward* with a
>    corrective deploy, because old code against a new schema is the state that
>    breaks in new ways).
> 4. **Which side moves first and why**, and how to verify the other side is
>    still compatible afterwards.
>
> Then add a "Rollback" section to `README.md` that links to this file, so the
> audit's `res-2` check finds it.

**What you'll learn from this fix:** That "undo the deploy" is only a real
option when your app lives in one place. The moment it lives in two, rolling
*forward* with a fix is often safer than rolling back — and knowing which
situation you're in beforehand is what makes the difference.

**How to know it worked:** Re-run the audit; `ms-2` and `res-2` both clear. The
better test: read your own doc and check you could follow it half-awake.

---

## 3. No emergency checklist for unattended jobs 🟠

**In plain English:** Five scheduled jobs run in production without you. When one
fails, everything you'd need to know is currently only in your head.

**What to ask Claude Code to do:**

> Create `docs/runbooks/incidents.md`. Read `convex/crons.ts` first and list the
> actual scheduled jobs by name — do not invent job names. For each, document:
> what it does, when it runs (note that Convex crons are UTC-only, per the
> existing comment in that file), how to tell whether it ran, how to re-run it
> by hand, and how to disable it if it keeps failing.
>
> Add a short section on the tool control panel: any tool can be toggled off in
> the dashboard, which blocks it at the route via `toolGate` before any work
> happens. That is the fastest kill switch for a misbehaving tool and it belongs
> in this doc.
>
> Add a section for "Zola says something wrong in the brief" — which is the most
> likely real failure — covering how to find the brief in Convex and how to
> rebuild it.
>
> Link this file from `README.md`.

**What you'll learn from this fix:** Writing a runbook is mostly a way of
discovering which recovery steps you've never actually tested. Expect to find at
least one where the honest answer is "I don't know" — that's the finding, and
it's worth more than the document.

**How to know it worked:** `res-1` clears in the audit. Better: pick one job,
follow your own doc to re-run it by hand, and confirm the steps are right.

---

## Phase 3: Worth Doing 🟡🟢

**Acceptance criteria for this phase:**
- [ ] `/api/health` returns 200 with a real Convex connectivity check
- [ ] `.env.example` exists listing every variable name in `.env.local`, with no real values
- [ ] Rate limiting protects the routes that spend money on paid APIs
- [ ] `.github/dependabot.yml` exists and a vulnerability scan runs in CI

## 4. Nothing notices if the app stops responding 🟡

**What to ask Claude Code to do:**

> Add `src/app/api/health/route.ts`. It should run one cheap real Convex query
> (not a hardcoded `return "ok"` — a health check that can't fail is worse than
> none), and return 200 with `{ ok: true }` on success or 503 with
> `{ ok: false, error }` on failure. Keep it unauthenticated so an uptime
> monitor can reach it, and make sure it returns no data about Tarik — status
> only. Set `export const dynamic = "force-dynamic"` so it is never cached.

**What you'll learn from this fix:** That a health check must check something
real. The failure mode people hit is a monitor cheerfully reporting green while
the database is unreachable.

**How to know it worked:** Visit `/api/health` on production; you get `{ok:true}`.

---

## 5. Nothing caps runaway API spending 🟡

**What to ask Claude Code to do:**

> Add simple rate limiting to the tool routes that call paid APIs. Start with
> `src/app/api/tools/[tool]/route.ts`, applied before the work happens — near
> the existing `toolGate` check is the natural place, since that's already the
> chokepoint every tool call passes through.
>
> Do not add a new dependency for this. A small in-memory counter keyed by tool
> name is enough for a single-user app; note in a comment that it resets on
> deploy and does not share state between serverless instances, and that this is
> a cost guard against runaway loops rather than a security control.
>
> Cap the expensive ones specifically — the tools that call Anthropic or research
> APIs (`write_lede`, `web_research`, `agentkey_research`, `browse`) — rather
> than throttling cheap local calls.

**What you'll learn from this fix:** Rate limiting usually protects you from your
own bugs, not from attackers. An infinite retry loop against a paid AI API is an
expensive lesson.

**How to know it worked:** Call one capped tool in a tight loop; the later calls
come back refused instead of billing you.

---

## 6. No settings template for a public repo 🟡

**What to ask Claude Code to do:**

> Create `.env.example`. Read `.env.local` and copy every variable NAME, with all
> values blank. Do not copy a single real value. Add a one-line comment above
> each explaining what it's for and where to get it. Confirm `.gitignore`'s
> `.env*` rule doesn't exclude it — if it does, add a `!.env.example` negation.

**What you'll learn from this fix:** The difference between configuration (safe
to share, belongs in git) and secrets (never in git). Same file shape, opposite
rules.

**How to know it worked:** `git status` shows `.env.example` as trackable, and
`git check-ignore .env.local` still confirms the real one is ignored.

---

## 7. Dependency updates arrive only if you look 🟢

**What to ask Claude Code to do:**

> Create `.github/dependabot.yml` with a weekly `npm` update schedule for `/`,
> and a `github-actions` ecosystem entry so the CI workflow's own actions stay
> current. Then add a step to `.github/workflows/ci.yml` that runs
> `npm audit --audit-level=high`. Make it non-blocking at first
> (`continue-on-error: true`) so it reports without failing your builds while you
> work through the existing backlog.

**How to know it worked:** Dependabot opens its first pull request within a week.

---

## When you're done

Re-run the full audit (not just `--fail-on critical`) and watch the score move
from **82** upward. Phase 1 alone clears both critical findings. The thing worth
feeling good about isn't the number — it's that after Phase 1, you can push code
without personally remembering to run 1,017 tests first.

## Manual steps for a human (not for the AI agent to execute)

1. ~~**Turn on branch protection for `main`.**~~ **DEFERRED 2026-08-20** — see
   the Phase 1 gate for the reasoning and the two conditions that should
   trigger revisiting it. Original note kept below for when that day comes.

   **Turn on branch protection for `main`.** GitHub Settings → Branches → add a
   rule requiring the CI check to pass before merging. Do this *after* Phase 1,
   once the check exists and has a name to select. Your repo is public, so this
   is available on the free tier — confirmed, not assumed. Requires clicking
   through the GitHub UI; an agent should not attempt it.
2. **Decide whether you want an uptime monitor at all,** and if so, sign up and
   point it at `/api/health`. Account creation is interactive.
3. **Run a proper secret scanner over full git history if you ever suspect a
   leak.** I checked by hand and found nothing — no `.env` ever committed, no key
   patterns anywhere in history — but a regex scan is not `gitleaks`. Worth doing
   once for a public repo, and it needs a human to review the results.
