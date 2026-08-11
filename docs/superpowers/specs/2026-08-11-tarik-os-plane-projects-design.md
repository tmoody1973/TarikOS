# Tarik OS — Plane Projects & Tasks Design

**Date:** 2026-08-11
**Status:** Proposed — pending review
**Milestone goal:** Tarik never opens plane.so. He says "start a project for the pledge drive" or "add calling the bank to my list", and it exists in Plane. `/projects` is a board he works in, not a mirror he reads.

## What this is

Tarik OS has no project or task layer. Telos holds goals, habits hold recurring
votes, Studio holds writing — but there is nowhere for *a discrete thing that
has to get done*. Plane Cloud is the execution workspace; this connects it.

The research document `docs/new-feat-research/Tarik OS × Plane_ Projects, Wiki,
and Second Brain Integration Design.md` specifies the integration. **This spec
supersedes it in three places**, each recorded below with its reason. Where they
do not conflict, that document remains the reference — particularly §5's
permission classes, §9's Second Brain rules, and §11's security requirements.

> The stated point, in Tarik's words: *"I don't want to go to plane.so to create
> a project and then come back to Zola to ask about them."* Any design where
> creation happens elsewhere fails the requirement.

## Reconnaissance — verified against the live API, 2026-08-11

Not from documentation. These are the shapes the workspace actually returns.

| | |
|---|---|
| Base URL | `https://api.plane.so` |
| Auth header | `X-API-Key: <token>` (a Workspace Access Token) |
| Workspace slug | `moody-and-co` |
| Projects | `GET /api/v1/workspaces/{slug}/projects/` |
| Work items | `GET/POST /api/v1/workspaces/{slug}/projects/{project_id}/issues/` |
| States | `GET .../projects/{project_id}/states/` |

**The API says `issues`; the UI says "work items".** Code should name things
`workItem` at the Tarik OS boundary and `issues` only in the URL, or every future
reader has to hold both vocabularies at once.

Work-item fields that matter: `name`, `description_html`, `state` (a state id),
`priority`, `target_date`, `sequence_id`, `assignees`, `labels`, `state_group`.

States are **per project**, each with a `group` of `backlog | unstarted |
started | completed | cancelled`. The default project ships Backlog, Todo, In
Progress, Done, Cancelled. **Group is the stable thing; names are not** — a
board that switches on the name breaks the first time a project is customised.

Responses are cursor-paginated: `{ results, total_count, next_cursor,
next_page_results }`. Anything that lists has to page or it silently truncates.

Existing contents: **Moody and Co** (`MOODY`) holds Plane's seven onboarding
tutorial items. **mkedev** (`MKEDEV1`) holds 18 real work items. The workspace
was described as empty; it is not.

## Decisions made

| Decision | Choice |
|---|---|
| Approach | Plane's **REST API only**. No MCP server — see below. |
| Storage | **No mirror tables.** Read Plane live. Tarik OS stores only links and settings — see below. |
| First ship | **Creation, plus a working board.** Not read-only — see below. |
| Auth | One Workspace Access Token, server-side. Personal single-workspace, so no OAuth (research doc §11 agrees). |
| Token location | `PLANE_API_TOKEN` in Vercel production, and `.env.local` for development against the real API. |
| Quick-todo default | An existing project, named in a Convex setting and editable on `/control` — the MUTED MAIL pattern. Seeded to **Moody and Co**, whose current contents are disposable. |
| Creating a task | Zola does it and confirms after. Additive and reversible. |
| Creating a project | Blueprint, then approval. Structural, and the failure mode is a pile of low-quality tasks. |
| Destructive actions | Not built. Zola cannot delete or archive anything in Plane. |
| Channel colour | Not ochre (Studio), not cyan (Telos), not violet (Brain). To be picked against DESIGN.md before any UI. |

### Supersedes 1 — no MCP server

The research document puts an "MCP Action Adapter" between the agent and Plane.
That does not fit this system. Zola is an ElevenLabs agent that calls HTTP
webhook tools; she has no MCP transport. All 38 of her tools are a `case` in
`src/app/api/tools/[tool]/route.ts`, and Plane's will be too.

MCP would only serve a Claude-in-the-loop text channel, and even there the
established pattern is an HTTP tool route. Dropping it removes a component, a
transport, and a second credential path, and costs nothing.

### Supersedes 2 — no mirror tables

The research document (§8) specifies Tarik OS tables mirroring every project and
work item, with `last_sync_hash`, `last_write_origin`, idempotency on
`delivery_id`, echo-loop guards and a conflict queue. That is the largest and
riskiest part of the whole design, and it exists to serve a team where records
change in Plane behind your back.

**Plane owns work items. Tarik OS will not keep a copy that can disagree with
them.** This is the rule this project has now applied four times in two days:
Studio links to briefs rather than owning them; exports go in `documents` rather
than a new table; Studio documents did not become thoughts; and Studio's text
recall has no `plain` column. A mirror is the same mistake at the largest scale
yet.

The board reads live. What Tarik OS *does* store:

- **Settings** — the default project for a quick todo.
- **Links** — which Second Brain records relate to which Plane project. This is
  Tarik OS's own knowledge and has no home in Plane.

Cost: a board load is one API round trip. Benefit: no sync layer, no conflicts,
no staleness, and the board is correct by construction.

*When this changes:* if a project brief needs semantic search, or the daily brief
needs "what changed while I slept", that needs webhooks and a store. Build it
then, for that reason, and only for the objects that need it.

### Supersedes 3 — creation ships first

The research document's phases run read-only → proposals → writes → sync. That
ordering protects shared records from an agent, and is right for a team.

This is a workspace of one, and until today it was empty. A read-only first
release would have had a tutorial project to show. More importantly it inverts
the requirement: the value is *not going to plane.so*.

So creation and reading ship together.

## Architecture

```
Zola (voice)                     Browser
     │                              │
     ▼                              ▼
/api/tools/<tool>              /projects  ── useQuery ──► Convex
     │  x-morpheus-secret           │                     (settings + links only)
     └──────────┬───────────────────┘
                ▼
        src/lib/plane.ts          ← the only file that knows Plane's API
                │  X-API-Key
                ▼
        api.plane.so
```

`src/lib/plane.ts` is the single boundary, in the shape of `src/lib/google.ts`
and `src/lib/googlePeople.ts`. Every Plane field name lives in it and nowhere
else. Pure request/response shaping goes in `src/lib/planeLib.ts` so it can be
tested without a network — the same split as `contactsLib` and `googlePeople`.

The token never reaches the browser. `/projects` calls a Next route, not Plane.

## Components

### `src/lib/planeLib.ts` — pure, tested

- `workItemPayload({title, description, priority, targetDate})` → the POST body,
  validated. Refuses an empty title rather than creating a nameless item.
- `boardColumns(states, items)` → items grouped by `state_group`, in
  backlog → unstarted → started → completed → cancelled order. **Grouped by
  group, never by name.**
- `rankProjects(projects, query)` → reuses the `rankSources` rule so "which
  project did he mean" has one answer across Studio, contacts and Plane.
- `describeStatus(items)` → the spoken summary: counts by group, what is
  blocked, what is due. Zola reads this; it must be a sentence, not a table.

### `src/lib/plane.ts` — the API boundary

`listProjects`, `getProject`, `listStates`, `listWorkItems`, `createWorkItem`,
`createProject`, `updateWorkItemState`. Cursor-paginated reads follow
`next_cursor` to completion. Every function throws a `PlaneError` carrying the
status, so a 401 reads as "the token is wrong" and not as an empty project list.

### Convex

```
planeSettings   : defaultProjectId, defaultProjectName, updatedAt
planeLinks      : planeProjectId, sourceType, sourceId, label, createdAt
```

Nothing else. `planeLinks` reuses the `studioRefs` shape deliberately — it is
the same idea pointed at a different anchor, and `REFERENCE_TYPES` already
enumerates what can be linked.

### Tools

| Tool | Ceremony | Notes |
|---|---|---|
| `create_task` | Confirms after | Title only; project defaults from settings. Fast enough to beat a sticky note. |
| `create_plane_project` | Blueprint, then spoken yes | Name, identifier, description. May create initial work items in the same approval. |
| `find_plane_project` | Read | Ranked candidates. Two matches is a question, never a guess. |
| `get_project_status` | Read | `describeStatus` — what is in flight, what is blocked, what is due. |
| `update_task_state` | Confirms after | Resolve the item by quoting its title, the `propose_studio_edit` pattern. Two matches → ask. |

Deliberately absent: delete, archive, bulk state changes, assignment changes.
They are the research document's "elevated confirmation" class and this release
has no confirmation mechanism strong enough for them.

### `/projects`

Board grouped by state group, one column each, work items as cards. Create from
the page as well as by voice — the page is where a keyboard is faster.

Below `lg` the board becomes one column with a state filter, the rule `/mail`
and `/contacts` already follow. A five-column board at 375px is five unusable
columns.

## Guardrails to write as tests

- `create_task` refuses an empty title.
- `boardColumns` groups by `state_group`, not by state name. *Mutation: rename
  "Todo" to "Next" in a fixture; the board must be unchanged.*
- A paginated list follows `next_cursor` rather than returning the first page.
  *Mutation: drop the cursor loop; a two-page fixture must fail.*
- `update_task_state` returns every candidate when a title is ambiguous, and
  writes nothing.
- No Plane tool deletes or archives.
- The token appears in no client component. *The whole point of the route split.*
- `PLANE_API_TOKEN` is read from the environment and never defaulted.

## Non-goals

- **Webhooks and inbound sync.** Deliberate — see Supersedes 2.
- **Plane Pages / Wiki.** Studio is where Tarik writes. A second writing surface
  needs its own argument, and the research document's answer (Plane owns
  published execution docs) may well be right — but not in this release.
- **Cycles, modules, initiatives.** Plane's own UI does these well and they are
  not what "I don't want to open plane.so" is about.
- **The Plane-native agent** (§6.5). Beta, needs OAuth, explicitly optional.
- **Multi-workspace.** One token, one workspace.
- **Deleting anything.**

## Open questions

1. **The channel colour.** Ochre, cyan and violet are taken. Needs picking from
   DESIGN.md's palette before any UI is written.
2. **Does `mkedev` matter to Tarik OS?** It has 18 real work items. If it should
   appear on the board it costs nothing; if it is someone else's project, the
   board may want a project allowlist.
3. **Do the seven tutorial items in Moody and Co get deleted first?** They will
   otherwise be the first thing the board ever shows. Tarik's call, in Plane.
4. **Priority and due dates by voice.** `create_task` takes a title only. If
   "due Friday" should work, that is `calendarLib`'s date parsing reused — worth
   it, but not required to ship.
5. **What links a Plane project to the Second Brain, and when?** `planeLinks`
   is specified but nothing populates it yet. The research document §9 has the
   rules; this release should probably ship the table and one manual "add
   source" action rather than any automatic capture.
