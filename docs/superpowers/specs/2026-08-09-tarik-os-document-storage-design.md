# Tarik OS — Document Storage & Sharing Design

**Date:** 2026-08-09
**Status:** Proposed — pending review
**Milestone goal:** Zola can turn a brief, research result, or journal digest into a durable file, hand the owner a private download, and — only on spoken confirmation — mint a link that works for someone who isn't signed in.

## What this is

Briefs, research findings, and journal digests currently exist only as Convex rows rendered on `/briefs` and `/brain`. There is no way to get one out of the app as a file: nothing to attach to an email, drop in a group chat, or hand to someone who has never seen the dashboard.

This adds a `documents` layer: Zola (or the owner, from the dashboard) can turn any of those surfaces into a stored file, retrieve it later, and — as a separate, explicitly confirmed action — produce a link that works without Clerk auth. It reuses the webhook-tool pattern end to end and treats "make something accessible to a non-owner" with the same seriousness as a calendar write.

## Decisions made

| Decision | Choice |
|---|---|
| Object storage | Cloudflare R2 (S3-compatible, zero egress, one more Vercel-friendly env var block — no new infra to run) |
| Link model | Never expose raw R2 URLs. A Convex `documentShareLinks` row (slug, expiry, revoked, download count) fronts a presigned R2 URL minted fresh on every visit |
| Public route auth | `/f/[slug]` is exempted from Clerk, same treatment as `/api/tools` in `proxy.ts` — access control lives in the slug + expiry + revocation, not a session |
| Guardrail | Creating a share link (the moment content becomes reachable by someone without a Clerk session) requires the same spoken-confirm ritual as a calendar write. Saving a document for the owner's own later retrieval does not — it never leaves the Clerk boundary |
| Default expiry | 7 days unless the owner asks for longer; "no expiry" is allowed but must be spoken explicitly, never the default |
| Rendering | Store what the source already produces — markdown/plain text for briefs and journal digests, PDF only when the owner asks to export as PDF. No new rendering pipeline for v1 |
| Where files come from | Existing surfaces only: a brief, a research result, a journal digest. No general-purpose "upload any file" surface in v1 — that's a different, larger feature |

## Why not Convex file storage

Convex has built-in file storage (`ctx.storage`), which would avoid a new provider entirely. It was considered and set aside for v1 because presigned, time-boxed, revocable *external* sharing is the actual requirement, and R2's S3-compatible presigned-URL model is the standard way to get that — Convex storage URLs are not built for the same revoke-on-demand, non-owner-facing use case. If a future need turns out to be owner-only retrieval with no external sharing, Convex storage is worth revisiting then.

## Architecture

```
Zola / dashboard action
   │
   ├── "save this brief as a document"
   │      buildDocumentFromBrief() / buildDocumentFromResearch() / buildDocumentFromJournal()
   │      → upload to R2 (src/lib/r2.ts)
   │      → documents row (Convex)
   │      → Zola speaks confirmation; card pushed via pushBriefingCards
   │
   └── "share that" ── spoken confirm ritual ──┐
                                                │
                                    documentShareLinks row (slug, expiresAt, revoked)
                                                │
                                                ▼
                              https://<app>/f/<slug>  (no Clerk)
                                                │
                              looks up slug → checks revoked/expiry/download cap
                                                │
                              mints short-lived R2 presigned GET URL → redirect
```

Convex crons are unaffected — nothing here runs on a schedule in v1.

## Components

### 1. `convex/schema.ts` additions

```ts
documents: defineTable({
  title: v.string(),
  sourceType: v.union(
    v.literal("brief"),
    v.literal("research"),
    v.literal("journal_digest"),
  ),
  sourceId: v.optional(v.string()), // briefs/journalEntries _id, when applicable
  objectKey: v.string(),            // path inside the R2 bucket
  filename: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.number(),
}).index("by_sourceType", ["sourceType", "createdAt"]),

documentShareLinks: defineTable({
  documentId: v.id("documents"),
  slug: v.string(),
  expiresAt: v.optional(v.number()),
  maxDownloads: v.optional(v.number()),
  downloadCount: v.number(),
  revoked: v.boolean(),
  createdAt: v.number(),
}).index("by_slug", ["slug"]),
```

Single-user by design (per `PRODUCT.md`) — no `ownerId` field needed; every row belongs to the one account, same as every other table in this schema.

### 2. `src/lib/r2.ts` (new, pure I/O wrapper)

`uploadBuffer(key, body, contentType)`, `getPresignedDownloadUrl(key, filename, expiresInSeconds)` — thin wrappers over `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, mirroring the shape of `src/lib/mail.ts` and `src/lib/research.ts` as the I/O boundary other modules call through.

New env vars (Vercel only, never `.env.local` for prod behavior): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`.

### 3. `src/lib/documentsLib.ts` (new, pure)

Slug generation, expiry/revocation/download-cap checks — the testable logic behind the public route, kept dependency-free the way `habitsLib.ts` and `toolOutcome.ts` are.

### 4. Webhook tools in `src/app/api/tools/[tool]/route.ts`

| Tool | Behavior |
|---|---|
| `save_document` | Args: `sourceType`, `sourceId` (or inline `title`/`text` for ad hoc saves). Renders the source content, uploads to R2, writes a `documents` row, pushes a briefing card, speaks confirmation. No confirm ritual — stays inside the Clerk boundary. |
| `share_document` | Args: `documentId` (or "the last one I saved"), optional `expiresInDays`. **Requires the spoken-confirm ritual** before the `documentShareLinks` row is created — same shape as the calendar-write confirmation already in the route. Speaks back the URL. |
| `revoke_document_share` | Args: `documentId` or `slug`. Sets `revoked: true`. No confirm ritual — revoking is always safe to do immediately. |

Each gets a matching entry in `TOOLS` in `scripts/provision-agent.ts` per `AGENTS.md`'s tool pattern; registry entry in `/control` is automatic on first successful call, same as every existing tool.

### 5. `src/app/f/[slug]/route.ts` (new, public)

Exempted from Clerk in `proxy.ts` alongside `/api/tools`. Looks up the slug, checks `revoked` / `expiresAt` / `maxDownloads` vs `downloadCount`, increments the counter, mints a presigned R2 URL (5-minute expiry — short-lived regardless of the link's own expiry window), and redirects. Any failed check returns a plain 404/410, not a stack trace or a hint about what the slug might have been.

### 6. `/documents` dashboard page (new, Clerk-protected)

Convex live query listing `documents`, matching the existing page shape (`/telos`, `/brain`). Per row: download (owner's own presigned URL, minted server-side on click), "create share link" (drives the same confirm ritual as the voice path when triggered from the UI), and revoke, for links already created by voice.

## Data policy

Source content (briefs, research, journal digests) can include mail summaries and personal reflection — the same category of content already flagged as sensitive in the observability design (`docs/superpowers/specs/2026-08-08-tarik-os-observability-evals-design.md`). Two things follow from that:

- Default share expiry is short (7 days) and every share creation is spoken-confirmed, never silent or automatic.
- `/f/[slug]` never lists or enumerates documents — a slug with no matching row returns the same 404 as a revoked or expired one, so there's nothing to probe.

This repo is public under MIT; nothing document-related is ever committed — content lives in R2, metadata in Convex, never in git.

## Testing

`node --test` files against pure functions, matching the existing `tests/` convention:

| File | Asserts |
|---|---|
| `tests/documentsLib.test.ts` | slug generation uniqueness/shape; expiry, revocation, and download-cap checks, including the "expired and revoked" combined case |
| `tests/documentShareGuardrail.test.ts` | `share_document` cannot create a `documentShareLinks` row without a confirmed ritual step — the same species of test as the existing no-send and credential-free-browsing invariants |
| `tests/publicShareRoute.test.ts` | unknown slug, revoked slug, and expired slug all return the same non-revealing response shape |

## Non-goals

- No general file-upload surface — sources are limited to briefs, research, and journal digests in v1
- No folder structure, tagging, or full-text search over documents
- No document versioning — saving again from the same source creates a new row
- No password-protected links in v1 (expiry + revocation + non-enumerable slugs are the v1 access model)
- No change to `/api/tools` auth model or the existing confirm-ritual mechanics beyond reusing them

## Open questions

1. **Rendering for "export as PDF."** V1 stores markdown/plain text as-is; a real PDF export needs a rendering library decision (e.g. a headless-Chromium print or a markdown-to-PDF library) — deferred until a concrete request for a PDF (vs. a plain-text/markdown file) shows up.
2. **Delivery beyond the dashboard.** Once SMS/calling ships (MOO-497/498/499), "text me that link" becomes a natural follow-on tool call — out of scope until the Telnyx integration lands.
3. **Retention.** Whether saved documents should ever auto-expire (independent of share-link expiry) is undecided; v1 keeps them until manually deleted.
