<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tarik OS (Morpheus)

Standalone real-time speech-to-speech personal AI assistant. Approved design
spec: `docs/superpowers/specs/2026-08-06-tarik-os-morpheus-design.md`.
Milestone logs (what's built, decisions, gotchas): `_build_plan/milestones/*/milestone-log.md`.

## Adding a tool to Morpheus (the repeatable pattern)

Every Morpheus capability is a webhook tool. To add one:

1. **Route:** add a `case "<tool_name>"` to `src/app/api/tools/[tool]/route.ts`.
   Read validated args from `body`, do the work, optionally push dashboard
   cards via `api.secondBrain.pushBriefingCards`, and return
   `{ ok, message, data? }` — `message` is what Morpheus can speak.
2. **Agent:** add a matching tool definition (name, spoken-purpose
   description, JSON body schema, `x-morpheus-secret` header) to `TOOLS` in
   `scripts/provision-agent.ts`, then run `node scripts/provision-agent.ts`
   to update the agent in place.
3. **Registry:** nothing to do — the tool auto-registers in the Convex
   `tools` table on its first successful call (via `markToolHealthy`) and
   then appears in the dashboard control panel with an enable/disable
   toggle, health dot, and last error. A tool toggled off is blocked at the
   route (`toolGate`) before any work happens.

Secrets: webhook auth uses `MORPHEUS_TOOL_SECRET` (Convex env + Vercel env).
Provider credentials live in Vercel env vars only.

## `_build_plan/`

The `_build_plan/` folder contains the initial PRD and per-milestone prompts used to scaffold this codebase during its initial build-out phase. These files are **temporary** — they exist for documentation and guidance only. They are **not** functional: no code, configuration, or runtime logic in this codebase should import, reference, or depend on anything inside `_build_plan/`.

Do not treat `_build_plan/` as long-living documentation for the codebase. The codebase will evolve past the assumptions and decisions captured here. Once the initial milestones are complete, this folder is expected to be deleted.
