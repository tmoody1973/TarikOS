# PRD: TarikOS Canvas

**Status:** Draft for refinement and implementation by Claude Code  
**Feature name:** TarikOS Canvas (working name)  
**Target release:** Canvas v1  
**Owner:** TarikOS  
**Audience:** Single user, private deployment  
**Primary UI foundation:** tldraw SDK with a hobby license for private, non-commercial production use

---

## 1. Executive summary

TarikOS Canvas is a persistent, AI-native visual workspace for turning scattered personal context into clear plans, decisions, and durable outputs. It combines a freeform infinite canvas with canonical TarikOS records—conversations, briefs, goals/Telos items, habits, mail-derived items, and agent outputs.

Canvas is not intended to be a generic Miro clone. Its differentiated purpose is to give the user and TarikOS agents a shared, inspectable spatial context in which evidence can be gathered, synthesized, organized, and converted into native TarikOS artifacts.

The initial release is single-user. It deliberately excludes real-time multi-user collaboration, public sharing, a template marketplace, and generic project-management feature parity with Miro.

---

## 2. Problem statement

TarikOS has several valuable but separated contexts: conversations, briefs, goals, habits, controls, and mail. Users need a way to place ideas, source material, decisions, and next actions together spatially—then ask AI to help make sense of that context without losing traceability.

Current failure modes this feature must solve:

- Important context remains trapped in linear chat threads, documents, and separate app sections.
- AI-generated plans are difficult to inspect, challenge, or connect to their input evidence.
- Turning an exploration into a brief, decision, or action plan involves manual copying and reformatting.
- A generic whiteboard would become an unstructured dead-end unless it remains connected to durable TarikOS records.

---

## 3. Goals and success criteria

### Goals

1. Let the user create a durable visual workspace for a project, question, goal, or decision.
2. Let the user add freeform visual elements alongside reference cards for existing TarikOS records.
3. Let an AI agent read explicitly selected board context and propose structured changes to the board.
4. Preserve provenance for all agent-created cards and artifacts.
5. Convert selected board context into native TarikOS Briefs and, where a task model exists, action items.
6. Deliver a polished private, single-user experience with reliable persistence and undo behavior.

### Success criteria

- A user can create a canvas and resume it later with scene state, title, and linked records intact.
- A user can add a Conversation, Brief, Telos item, Habit, or Mail item to a board without duplicating the source object.
- A user can select board elements and ask the agent to cluster, summarize, identify dependencies, or create a plan.
- The agent never changes the board silently; every multi-element edit is proposed and accepted/rejected as a batch.
- An exported/generated Brief includes links or structured references back to the selected evidence.
- Canvas creation, loading, normal editing, and AI proposal previews work acceptably on a normal desktop browser.

---

## 4. Product principles

- **Canonical data stays canonical.** Canvas cards reference TarikOS records; they do not replace them.
- **Agent actions are visible.** Users see intended additions, modifications, deletions, and source context before mutation.
- **Selection is consent.** By default, an agent only uses elements explicitly selected by the user, plus minimal canvas metadata. “Use entire canvas” is a separate, explicit option.
- **Provenance is first class.** AI output identifies agent run, prompt/action, time, input element IDs, and source records.
- **Spatial structure has semantic value.** Frames, arrows, groups, and proximity can be supplied to the agent as context, but the agent must not infer factual claims solely from visual adjacency.
- **Private by default.** v1 assumes one authenticated owner and no public sharing.
- **Useful before expansive.** Ship the board and four high-value AI actions before adding many templates or specialized object types.

---

## 5. Personas and primary jobs

### Primary persona

The sole TarikOS user: a technically proficient individual using TarikOS as a private personal operating system for research, planning, creative work, and goal execution.

### Jobs to be done

- “When I am exploring an idea across chats and notes, help me see the important pieces together.”
- “When I am planning a project, help me turn research and thoughts into a coherent plan.”
- “When an agent makes a recommendation, let me inspect exactly what it relied on.”
- “When I finish thinking visually, convert the useful result into a durable brief or actionable plan.”

---

## 6. Scope

### In scope: Canvas v1

- Canvas index and canvas detail routes.
- Create, rename, archive, and delete a private canvas.
- tldraw infinite canvas with standard drawing, text, sticky notes, shapes, arrows/connectors, images, and frames.
- Durable server-side persistence of scene, viewport, and canvas metadata.
- Reference cards for TarikOS Conversations, Briefs, Telos items, Habits, Mail items, and generic URLs/notes.
- Drag/create linked references from relevant TarikOS views into a new or existing canvas.
- A Canvas inspector panel for selected elements.
- Board-scoped AI command palette/sidebar.
- Four initial agent actions: summarize, cluster, map dependencies, and draft a brief/plan.
- Proposal preview, accept, reject, undo, and provenance metadata.
- Export selected items or a frame to Markdown as a convenience output.
- Basic responsive handling: desktop-first, usable read-only/mobile view; full canvas editing may be desktop-only in v1.

### Explicitly out of scope: Canvas v1

- Real-time collaborative editing, presence cursors, teams, comments, or public links.
- A Miro-like template catalog or workshop/facilitation suite.
- Kanban as a fully transactional task manager.
- Full diagrams.net/Lucidchart-style diagram syntax and auto-layout.
- Automatic use of all TarikOS data as hidden agent context.
- Autonomous background agents that alter a canvas without the user present.
- Importing Miro boards.
- Full version-history UI beyond normal undo and proposal/audit records.
- Bidirectional Git/Markdown workspace synchronization.

---

## 7. User experience

### 7.1 Entry points

Add a **Canvas** item to primary navigation.

Supported creation paths:

1. Create blank canvas from `/canvas`.
2. “Open in Canvas” from a Conversation, Brief, Telos item, Habit, or Mail item.
3. “Create canvas from selection” when multiple compatible TarikOS records are selected.
4. “Create a planning canvas” from a Telos goal, pre-populating a goal reference card and an empty Plan frame.

### 7.2 Canvas index

The canvas index displays cards with title, optional description, updated time, thumbnail if practical, linked-object counts, and a one-line purpose summary. It supports search, sort by recent, archive visibility, and create action.

### 7.3 Canvas layout

- **Top bar:** Breadcrumb/title, save status, undo/redo, AI button, export, overflow actions.
- **Center:** tldraw board.
- **Left tools:** Native tldraw tools plus TarikOS insertion tools: Add record, Add source, Add task/action, Add AI output.
- **Right inspector:** Selection details, linked object preview, provenance, and quick actions.
- **AI panel:** Opens as a right-side panel or command dialog. It lists allowed input scope and renders proposal diffs.

### 7.4 Element types

| Element | Purpose | Canonical source | Behavior |
|---|---|---|---|
| Sticky note | Freeform thought or observation | Canvas only | Editable text, color, optional tags |
| Text/shape/arrow/frame | Visual structure | Canvas only | Native tldraw element behavior |
| Note card | Longer manual note | Canvas only | Title/body/tags; may later convert to Brief |
| Conversation card | A linked conversation or excerpt | Conversation | Shows title, excerpt, date; opens source |
| Brief card | A linked TarikOS Brief | Brief | Shows title/status/summary; opens source |
| Telos card | Goal, initiative, or objective reference | Telos | Shows title/status/date; opens source |
| Habit card | Habit reference | Habit | Shows title/streak/schedule if available; opens source |
| Mail card | Linked email or extracted action | Mail | Shows subject/sender/date; opens source |
| Source card | URL, uploaded asset, or citation | Source metadata | Shows title/domain/summary; opens URL |
| Agent output card | Material created by an agent | Agent run + canvas | Shows generated content and provenance |
| Action card | Proposed or confirmed next action | Native task model when available; otherwise Canvas | Can convert into a native TarikOS action later |

### 7.5 Linked-record behavior

A linked card stores a source reference such as `{ sourceType, sourceId }` and a lightweight display snapshot. The source record remains the authority. When the source changes, the card shows a subtle “source updated” state and the user can refresh its snapshot.

A user can choose whether a card displays a snapshot excerpt, a live summary, or only a title. Do not automatically sync or overwrite a user-edited local annotation.

---

## 8. AI behavior

### 8.1 Agent context contract

The client serializes only the allowed selected content into a structured context packet. The server validates ownership, resolves source references, applies permissions/data minimization, and invokes the existing TarikOS Anthropic integration.

Example context packet:

```ts
interface CanvasAgentContext {
  canvas: { id: string; title: string; purpose?: string }
  inputScope: "selection" | "frame" | "canvas"
  elements: Array<{
    id: string
    type: string
    text?: string
    bounds: { x: number; y: number; w: number; h: number }
    frameId?: string
    links?: Array<{ sourceType: string; sourceId: string }>
  }>
  sourceRecords: Array<{
    sourceType: string
    sourceId: string
    title: string
    excerpt?: string
    canonicalUrl?: string
  }>
  request: string
}
```

Do not send full source record bodies unless they are required for the user’s requested action and allowed by the selected scope.

### 8.2 Initial AI actions

| Action | Inputs | Proposal output |
|---|---|---|
| Summarize selection | Selected cards/frame | Summary frame, key themes, open questions, no source mutation |
| Cluster ideas | Sticky notes/cards | Suggested grouping frames, labels, optional arrows; preserves originals |
| Map dependencies | Selected goals/actions/cards | Dependency arrows, risks/blockers, ordered action suggestions |
| Draft Brief / Plan | Selected evidence | A proposed Brief outline/content and optionally a roadmap frame/action cards |

### 8.3 Proposal model

The agent must return structured operations rather than raw imperative UI code.

```ts
type CanvasOperation =
  | { type: "create"; element: ProposedCanvasElement }
  | { type: "update"; elementId: string; patch: Partial<ProposedCanvasElement> }
  | { type: "delete"; elementId: string }
  | { type: "createNativeArtifact"; artifactType: "brief" | "action"; payload: unknown }

interface CanvasProposal {
  id: string
  canvasId: string
  summary: string
  rationale: string
  sourceElementIds: string[]
  operations: CanvasOperation[]
  warnings: string[]
  createdAt: number
}
```

The UI renders proposal elements in a distinct temporary style/layer. The user can accept the entire proposal, reject it, or—if practical in v1—deselect individual operations. Acceptance executes one transactional mutation and writes an audit event. Rejection persists only a minimal event record, not proposed board state.

### 8.4 Guardrails

- The agent may not delete existing user elements in v1. It can suggest deletions as a warning only.
- The agent may not mutate canonical TarikOS records from a canvas action without a separate native-artifact confirmation.
- The agent cannot access unselected mail, conversations, or private records merely because it is operating on a board.
- Agent-produced factual claims should link to supplied source cards/records where possible; otherwise label them as synthesis or suggestion.
- Every proposal includes an undo path after acceptance.

---

## 9. Data and persistence

### 9.1 Persistence strategy

Use Convex as the source of truth for canvas metadata, board snapshots, references, proposals, and audit events. The tldraw editor operates client-side; autosave writes a normalized serialized snapshot after debouncing and on explicit save/navigation lifecycle events.

Start with snapshot persistence, not CRDT collaboration. Store a full current scene snapshot and optional bounded historical snapshots/checkpoints. This keeps v1 simple for a single user.

### 9.2 Suggested Convex schema

Names should be adjusted to actual TarikOS schema conventions.

```ts
canvases: defineTable({
  ownerId: v.id("users"),
  title: v.string(),
  description: v.optional(v.string()),
  purpose: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("archived")),
  scene: v.any(),
  appState: v.any(),
  schemaVersion: v.number(),
  thumbnailStorageId: v.optional(v.id("_storage")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerId", "updatedAt"]),

canvasReferences: defineTable({
  canvasId: v.id("canvases"),
  elementId: v.string(),
  sourceType: v.string(),
  sourceId: v.string(),
  displaySnapshot: v.any(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_canvas", ["canvasId"])
  .index("by_source", ["sourceType", "sourceId"]),

canvasAgentRuns: defineTable({
  canvasId: v.id("canvases"),
  ownerId: v.id("users"),
  request: v.string(),
  inputScope: v.string(),
  sourceElementIds: v.array(v.string()),
  status: v.string(),
  model: v.optional(v.string()),
  proposal: v.optional(v.any()),
  acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_canvas", ["canvasId"]),

canvasEvents: defineTable({
  canvasId: v.id("canvases"),
  actorType: v.union(v.literal("user"), v.literal("agent")),
  actorId: v.optional(v.string()),
  eventType: v.string(),
  payload: v.any(),
  createdAt: v.number(),
})
  .index("by_canvas_created", ["canvasId", "createdAt"])
```

### 9.3 Scene versioning and migrations

Persist `schemaVersion` alongside scene data. Implement a migration/normalizer function before hydrating a board. Never assume old tldraw serialized records remain valid after dependency upgrades; write tests against saved fixtures before upgrading tldraw.

### 9.4 Autosave requirements

- Debounce scene updates (target 500–1,500 ms after last change).
- Display `Saving`, `Saved`, and `Save failed` states in the top bar.
- Avoid overlapping writes; queue or coalesce snapshots.
- Save before route changes when possible.
- Preserve the last known local snapshot in browser storage as a recovery fallback, then reconcile with server state on load.

---

## 10. Technical architecture

### 10.1 Existing integration assumptions

TarikOS is a Next.js/TypeScript application with Convex present in the repository and an Anthropic SDK dependency. Existing routing includes Brain, Briefs, Control, Conversations, Habits, Mail, and Telos. Canvas should follow existing auth, server action/API, styling, and component conventions rather than introduce a second application or backend. Verify actual module boundaries before implementation.

### 10.2 Proposed module layout

```text
src/
  app/
    canvas/
      page.tsx                    # Canvas index
      [canvasId]/
        page.tsx                  # Canvas workspace route
  components/
    canvas/
      CanvasEditor.tsx
      CanvasToolbar.tsx
      CanvasInspector.tsx
      CanvasAgentPanel.tsx
      CanvasProposalPreview.tsx
      CanvasReferenceCard.tsx
      CanvasCreateDialog.tsx
  lib/
    canvas/
      types.ts
      scene.ts
      references.ts
      agentContext.ts
      proposal.ts
      tldraw.ts
convex/
  canvases.ts
  canvasReferences.ts
  canvasAgentRuns.ts
  canvasEvents.ts
```

### 10.3 tldraw integration

- Add the current tldraw SDK following its official Next.js/React integration guidance.
- Keep editor components client-side due to browser/canvas APIs.
- Add `TLDRAW_LICENSE_KEY` to the client-exposed environment configuration exactly as required by tldraw. Treat the key as publicly exposable only if tldraw documentation confirms this for the license-key type in use.
- Maintain the hobby-license watermark as required.
- Use standard tldraw shapes for v1 wherever possible; implement custom TarikOS record cards only where needed.
- Keep tldraw-specific serialization isolated in `lib/canvas` so a future canvas-engine change is feasible.

### 10.4 Agent endpoint

Create a canvas-specific server endpoint/action, for example `POST /api/canvas/agent` or an established TarikOS agent-action pattern.

The endpoint must:

1. Authenticate the owner.
2. Confirm canvas ownership.
3. Validate selected element IDs belong to the canvas.
4. Resolve authorized linked records.
5. Build a bounded context packet.
6. Call the existing Anthropic service layer.
7. Validate the structured proposal against a schema.
8. Store the proposal as a pending `canvasAgentRun`.
9. Return it without mutating the scene.

Proposal acceptance uses a distinct mutation. It revalidates ownership, proposal status, and element IDs before applying the normalized operation set.

---

## 11. Functional requirements

### FR-1: Canvas CRUD

- Users can list active canvases they own.
- Users can create a blank canvas with title and optional purpose.
- Users can rename, archive, restore, and permanently delete their own canvases.
- Permanent deletion requires confirmation and removes associated reference/proposal records according to data-retention conventions.

### FR-2: Board editing and storage

- A canvas loads its persisted scene and viewport reliably.
- Standard editor changes persist automatically.
- User can undo/redo local editor operations using tldraw behavior.
- The UI indicates save state and does not claim successful saving if persistence fails.

### FR-3: Reference cards

- User can insert TarikOS records using a searchable picker.
- Every reference card stores `sourceType`, `sourceId`, and a display snapshot.
- Clicking a card opens the canonical TarikOS record in an appropriate view.
- User may add local board-only annotations to a reference card without changing source data.

### FR-4: AI proposals

- User can invoke supported actions on selected elements, a frame, or the entire canvas through an explicit scope selector.
- AI responses render as a proposal before board mutation.
- User can accept or reject a proposal.
- Accepted AI elements visually retain provenance available in the inspector.
- The feature must handle invalid model output gracefully, with retry and user-readable error state.

### FR-5: Native artifact creation

- User can generate a draft Brief from selected items or a frame.
- Brief creation previews title, structure, and source references before creating the native object.
- The resulting Brief links back to the canvas and agent run where relevant.

### FR-6: Security and privacy

- Every query and mutation scopes data by authenticated owner.
- Canvas references cannot be used to bypass authorization to a source record.
- AI context is explicitly selected or otherwise visibly scoped.
- Logs avoid persisting raw private context beyond product requirements and existing TarikOS privacy behavior.

---

## 12. Non-functional requirements

- **Reliability:** A normal board edit should not be lost during ordinary navigation or refresh; provide local recovery for unsaved work.
- **Performance:** Loading a typical personal board should feel immediate after route load. Avoid sending full scene snapshots on every pointer move.
- **Accessibility:** Core controls, dialogs, inspector content, and AI proposal actions must be keyboard navigable and screen-reader labeled. Canvas interaction has inherent limits; provide accessible alternatives for linked-item lists and proposal review.
- **Observability:** Record structured events for load failures, save failures, agent proposal lifecycle, and artifact creation.
- **Testing:** Unit-test serialization, authorization, context construction, proposal validation, and Convex mutations. Add end-to-end tests for create → edit → reload, reference insertion, proposal accept/reject, and Brief generation.

---

## 13. Acceptance criteria

### Canvas foundation

- [ ] Authenticated user can navigate to `/canvas`, create a blank canvas, name it, and reopen it.
- [ ] Text, sticky notes, shapes, arrows, frames, and images persist through reload.
- [ ] Save state accurately indicates pending, successful, and failed persistence.
- [ ] User can archive and restore a canvas.

### TarikOS integration

- [ ] A user can add at least Conversation, Brief, and Telos references from a picker or source route.
- [ ] Reference card opens its canonical source record.
- [ ] Card snapshot refresh does not overwrite user-added board annotations.

### AI

- [ ] User can select items, run “Cluster ideas,” and see a proposal without scene mutation.
- [ ] User can accept the proposal and see every created element persisted.
- [ ] User can reject a proposal with no scene changes.
- [ ] Inspector shows the originating agent run and source elements for accepted agent output.
- [ ] User can create a previewed Brief from selected canvas content.

### Safety

- [ ] An agent call rejects unauthorized canvas IDs, element IDs, and source records.
- [ ] Agent does not have access to unselected linked source content by default.
- [ ] v1 agent proposals cannot delete user-created board elements.

---

## 14. Delivery plan

### Phase 0: Discovery and foundation

- Review TarikOS architecture, auth patterns, Convex schema conventions, and current Anthropic integration.
- Confirm tldraw hobby-license eligibility and obtain/configure the required production key before deployment.
- Install the editor and render a client-only prototype route.
- Decide exact source-type mappings for Conversations, Briefs, Telos, Habits, and Mail.

### Phase 1: Persistent board

- Implement Convex canvas schema and authorization.
- Build index/create/detail routes.
- Embed tldraw and implement debounced persistence, loading, error states, and local fallback.
- Implement archive/delete.

### Phase 2: Native TarikOS context

- Implement searchable record picker and reference-card shape/rendering.
- Add “Open in Canvas” entry points from key TarikOS routes.
- Build inspector and source-preview behaviors.

### Phase 3: Agent proposals

- Implement context serialization and authorization checks.
- Add structured output schema and proposal persistence.
- Ship summarize, cluster, dependencies, and plan/brief draft actions.
- Implement accept/reject, provenance, and undo/recovery behavior.

### Phase 4: Hardening

- Add tests, performance safeguards, instrumentation, and migration fixtures.
- Improve keyboard support and mobile/read-only behavior.
- Refine the visual language and initial starter canvases.

---

## 15. Open questions for refinement

1. What is the canonical TarikOS task/action entity, if any? If none exists, should Canvas v1 create actions as board-only cards or introduce a native action model?
2. Which existing route/entity should be the primary anchor for a project canvas: Telos, Briefs, Brain, or a new project abstraction?
3. Does TarikOS already have user IDs/auth tables in Convex, and what are their exact names?
4. Does the existing Anthropic integration support tool/structured outputs, streaming, and persisted run metadata? Reuse it rather than creating a parallel agent framework.
5. Should source cards permit URLs only, or should they also support uploaded files from the first release?
6. Should canvas snapshots be stored directly in Convex documents or externalized to file storage once boards exceed a defined serialized size?
7. Is the initial desired visual style hand-drawn/freeform (native tldraw) or a cleaner product-planning board? This affects card/chrome design but not the underlying architecture.
8. Is a canvas intended to be part of a future shareable product, or permanently a private personal surface? This changes the prioritization of Yjs/multiplayer and commercial licensing.

---

## 16. Implementation instructions for Claude Code

1. Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `README.md`, `package.json`, and existing Convex modules before changing code. Treat this PRD as product intent, but existing repository conventions as implementation authority.
2. Produce a short architecture plan and identify exact existing entities/routes that map to the source types above before coding.
3. Do not introduce Kanwas, AdonisJS, Yjs, a separate collaboration server, or a second database in Canvas v1.
4. Do not build multiplayer in this iteration.
5. Do not make direct Anthropic calls from the browser. Keep context resolution, authorization, and model calls server-side.
6. Use schema validation for all client input, persisted scene envelopes, and model-proposed operations.
7. Keep tldraw integration behind a small adapter boundary; avoid spreading raw tldraw record assumptions across unrelated TarikOS components.
8. Implement in reviewable commits/PR-sized steps: foundation, persistence, reference cards, AI proposal workflow, and tests.
9. Before declaring done, run typecheck, lint, relevant tests, and a manual browser flow covering reload persistence and proposal rejection.
10. Document the environment variables, license-key configuration, data schema migrations, and recovery behavior in the repository documentation.

---

## 17. Later opportunities (not v1)

- Collaborative canvases with Yjs-compatible synchronization, presence, permissions, and comments.
- Canvas-to-code workflows: generate an implementation brief or GitHub issue set from a system-design frame.
- Specialized canvas modes: research synthesis, life planning, roadmap, decision record, or campaign/relationship map.
- Full-text retrieval across canvas elements and linked TarikOS content.
- Agent “what changed?” board review and recurring planning rituals.
- Canvas templates and saved reusable frames.
- Export/import format improvements and image/PDF export.
