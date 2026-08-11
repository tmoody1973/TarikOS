# PRD: TarikOS Studio — AI Collaborative Rich-Text Documents

**Status:** Draft for refinement and implementation by Claude Code  
**Feature name:** TarikOS Studio (working name)  
**Target release:** Studio v1  
**Audience:** Single authenticated user, private TarikOS deployment  
**Editor foundation:** Tiptap / ProseMirror rich-text editor  
**Persistence foundation:** Existing TarikOS/Convex architecture  
**AI foundation:** Existing server-side Anthropic integration

---

## 1. Executive summary

TarikOS Studio is a first-class rich-text document workspace where the user and TarikOS agent collaboratively create, revise, organize, and turn ideas into durable artifacts. It uses Tiptap for direct WYSIWYG user editing and persists structured Tiptap JSON as the canonical document format.

Studio is not a Markdown editor with an AI chat bolted on. It is a structured document environment with a user-controlled AI collaborator: the user chooses document scope and attached TarikOS context; the agent proposes precise document changes; the user reviews and accepts or rejects those changes; TarikOS stores accepted versions and provenance.

Studio complements TarikOS Canvas. Canvas is for spatial sense-making, research synthesis, mapping, and planning. Studio is for linear thinking, writing, revisions, brief creation, and polished long-form outputs. Both features must exchange durable, traceable references.

---

## 2. Problem statement

TarikOS needs a durable place for long-form work that is more capable than chat and more structured than a plain note. Users need to draft briefs, plans, analyses, decision records, personal writing, and project documents with an AI collaborator without losing control of content or obscuring what changed.

The feature must solve these problems:

- Valuable content is trapped in conversations or copied manually between chat, notes, and briefs.
- AI rewrites can overwrite a document or make changes that are hard to inspect and reverse.
- Research and planning sources lack clear links to the finished written artifact.
- Markdown is useful for interoperability but is not the desired direct editing experience.
- A document needs to remain a canonical TarikOS record even when the AI chat context is deleted or unavailable.

---

## 3. Goals

1. Provide a polished, private, rich-text editor for persistent TarikOS documents.
2. Store structured Tiptap JSON as canonical document content.
3. Let the user use Claude to revise selected text, a section, or an explicitly selected whole-document scope.
4. Require user review before an AI-authored change is applied.
5. Store accepted revision checkpoints and make restoration possible.
6. Preserve source context and provenance for generated content and AI-assisted revisions.
7. Connect Studio documents to TarikOS Canvas, Conversations, Briefs, Telos, Mail, and sources without duplicating canonical data.
8. Reuse the Canvas agent-proposal principles and existing TarikOS auth, Convex, and Anthropic patterns.

---

## 4. Non-goals: Studio v1

- Real-time multi-user collaboration, cursors, presence, shared comments, or public document links.
- Tiptap Cloud, Yjs, Hocuspocus, or a separate real-time collaboration server.
- Replacing every existing TarikOS Brief route or data model in the first iteration.
- Full Google Docs/Microsoft Word compatibility.
- Arbitrary HTML embedding or unrestricted custom script blocks.
- An unrestricted autonomous agent that changes documents without direct user invocation and approval.
- Full visual track-changes parity in the first release.
- Native PDF/DOCX import/export in v1.
- A full code editor or executable preview environment.

---

## 5. Product principles

- **User owns the document.** The user can directly edit any document content at any time.
- **Tiptap JSON is canonical.** JSON is persisted as the editable source of truth; HTML, plain text, Markdown, and exports are derived representations.
- **The agent proposes; the user decides.** AI never silently replaces user-written text.
- **Scope is explicit.** Selected text is default agent scope. Section and entire-document scopes require visible user selection.
- **Every durable AI change is traceable.** Store the agent run, action, input scope, source references, and accepted revision.
- **References, not copies.** TarikOS records are linked through source IDs and display snapshots, not duplicated as mutable content.
- **Document first, chat second.** The document is useful and readable without its surrounding chat history.
- **Schema before content.** The editor only persists valid content conforming to the enabled Tiptap schema.

---

## 6. Primary user and jobs

### Primary user

The sole authenticated TarikOS user, using the system as a private personal workspace for planning, research, personal operations, creative work, and durable writing.

### Jobs to be done

- “Help me turn a conversation or a Canvas into a clear, durable brief.”
- “Help me revise a passage without erasing my intent or hiding what changed.”
- “Keep my source context connected to the final document.”
- “Help me turn notes and research into a plan with actions and open questions.”
- “Let me use a rich editor naturally, while giving my agent precise enough structure to edit safely.”

---

## 7. Scope: Studio v1

### In scope

- `/studio` document index and `/studio/[documentId]` document workspace.
- Create, rename, archive, restore, and permanently delete private documents.
- Tiptap rich-text editing with a curated extension set.
- Convex persistence of document metadata and Tiptap JSON.
- Debounced autosave and clear save/error/recovery state.
- Native document types: note, draft, brief, plan, decision record.
- Reference links to Canvas, Conversation, Brief, Telos, Habit, Mail, source URL, and generic attachment metadata.
- AI side panel with scoped requests and curated quick actions.
- AI-generated change proposals, review UI, acceptance/rejection, and provenance.
- Explicit document versions/checkpoints and restore behavior.
- Create a Studio document from Canvas selection.
- Open a Studio document as a linked Canvas card.
- Markdown/plain-text export as a derived convenience output.

### Recommended initial editor extension set

- Tiptap StarterKit: document, paragraph, heading, text, bold, italic, strike, bullet list, ordered list, list item, blockquote, code block, hard break, horizontal rule, history.
- Link.
- Placeholder.
- Typography.
- Character count.
- TaskList and TaskItem.
- Highlight.
- Table/TableRow/TableHeader/TableCell only if existing TarikOS styling supports them well.
- Image only if attachments/storage are already implemented safely in TarikOS.
- Custom TarikOSReference node for links to canonical TarikOS records.
- Custom AIProposalMark or non-persisted proposal decoration layer, depending on implementation feasibility.

### Excluded from initial extension set

- Collaboration/Cursor extensions.
- Comment threads.
- Embedded arbitrary iframes.
- Raw HTML editing.
- Mention/autocomplete unless it can use the same safe TarikOS-reference picker.

---

## 8. Document model

### 8.1 Canonical document record

```ts
import type { JSONContent } from "@tiptap/react"

type StudioDocumentType =
  | "note"
  | "draft"
  | "brief"
  | "plan"
  | "decision_record"

type StudioDocument = {
  _id: Id<"studioDocuments">
  ownerId: Id<"users">
  title: string
  documentType: StudioDocumentType
  status: "active" | "archived"
  contentJson: JSONContent
  plainText: string
  excerpt?: string
  schemaVersion: number
  createdAt: number
  updatedAt: number
  lastVersionAt?: number
}
```

`contentJson` is the source of truth. `plainText` and `excerpt` are derived server-side or in a trusted mutation path for search/indexing/list previews. Do not rely on HTML as canonical storage.

### 8.2 Document references

```ts
type StudioReferenceType =
  | "canvas"
  | "canvas_frame"
  | "canvas_element"
  | "conversation"
  | "brief"
  | "telos"
  | "habit"
  | "mail"
  | "source_url"
  | "attachment"

type StudioDocumentReference = {
  _id: Id<"studioDocumentReferences">
  documentId: Id<"studioDocuments">
  nodeId?: string
  sourceType: StudioReferenceType
  sourceId: string
  displaySnapshot: {
    title: string
    excerpt?: string
    url?: string
    updatedAt?: number
  }
  createdAt: number
  updatedAt: number
}
```

References may appear inline through `TarikOSReference` nodes or exist only in a document-level source panel. The canonical record remains in its original TarikOS subsystem.

### 8.3 Versions

```ts
type StudioDocumentVersion = {
  _id: Id<"studioDocumentVersions">
  documentId: Id<"studioDocuments">
  versionNumber: number
  title: string
  contentJson: JSONContent
  plainText: string
  reason: "manual" | "agent_accept" | "restore" | "milestone"
  agentRunId?: Id<"studioAgentRuns">
  createdAt: number
}
```

Create a version when:

- The user explicitly chooses “Save version.”
- An AI proposal is accepted.
- A document is restored from a prior version.
- A future workflow marks a document as a milestone/final.

Do not create a version on every keystroke. Retain a sensible bounded history or apply the repository’s established retention policy.

---

## 9. User experience

### 9.1 Entry points

Add **Studio** to primary navigation.

Support creation from:

1. The Studio index: blank document, note, brief, plan, decision record.
2. Canvas: “Create document from selection” or “Draft a brief from frame.”
3. Conversation: “Create Studio document from conversation/excerpt.”
4. Brief: “Open/Edit in Studio” only if the existing Brief model is adapted or linked intentionally.
5. Telos: “Create plan document.”

### 9.2 Studio index

The index displays documents with title, type, excerpt, updated timestamp, optional source badges, and status. Include create, search, recent sorting, type filtering, archive filter, and quick “open last edited” behavior.

### 9.3 Studio workspace layout

- **Top bar:** Breadcrumb, editable title, document type, save state, version menu, undo/redo, AI action, export, overflow actions.
- **Main center:** Tiptap editor with a clean readable writing layout.
- **Formatting toolbar:** Fixed/minimal or selection-aware bubble menu; it must support keyboard shortcuts.
- **Right inspector:** Toggle between Document details, Sources, Outline, and Version history.
- **AI panel:** Context/scope control, quick actions, chat/request input, proposal review, agent run history.

The editor should be desktop-first. Mobile v1 should support reading and basic editing if practical, but may hide complex panes behind buttons.

### 9.4 Document types

| Type | Default structure | Primary outcome |
|---|---|---|
| Note | Blank title + body | Capture and develop a thought |
| Draft | Title + body | General writing workspace |
| Brief | Summary, context, findings, recommendation, next steps | Durable shareable analysis/brief |
| Plan | Objective, outcomes, milestones, actions, risks | Execution-ready plan |
| Decision record | Context, options, decision, rationale, consequences | Traceable decision |

Templates are optional starter content, not rigid document schemas. The user may freely modify structures after creation.

---

## 10. Tiptap schema and editor design

### 10.1 Required content model

Enable a controlled schema and validate persisted content against it before saving. Content must degrade gracefully if an extension is removed or its node attrs evolve in a future release.

Base node support:

```text
Document
Paragraph
Heading (levels 1–3 initially)
Text
BulletList / OrderedList / ListItem
TaskList / TaskItem
Blockquote
CodeBlock
HardBreak
HorizontalRule
Table family (optional for v1)
Image (optional based on existing attachment infrastructure)
TarikOSReference (custom inline or block atom)
```

Base marks:

```text
Bold
Italic
Strike
Code
Link
Highlight
```

### 10.2 TarikOSReference node

A custom node represents a stable pointer to a TarikOS object. It must not embed unbounded source text in node attributes.

```ts
type TarikOSReferenceAttrs = {
  referenceId: string
  sourceType: StudioReferenceType
  sourceId: string
  label: string
  href?: string
}
```

Display it as a compact pill/card with an icon and title. Clicking it opens a popover preview with actions: Open source, Refresh snapshot, View provenance, Remove from document.

### 10.3 HTML and Markdown

- Tiptap JSON: canonical persisted format.
- HTML: derived only for secure rendering/export where required; sanitize any imported HTML.
- Markdown: derived export/import convenience only, with documented fidelity limitations.
- Plain text: derived for document listings and search.

---

## 11. AI collaboration model

### 11.1 Scope controls

Every request makes the included scope visible. Default to selected text when a valid selection exists.

| Scope | What is sent to agent | Use case |
|---|---|---|
| Selection | Selected structured Tiptap fragment plus minimal local context | Rewrite, expand, shorten, change tone |
| Section | Current heading section and its child content | Improve a chapter/section coherently |
| Document | Entire serialized document, bounded by size limits | Outline, critique, restructure |
| Attached sources | User-chosen linked records/sources | Ground a draft in evidence |
| Canvas frame/selection | Explicit Canvas references and resolved authorized content | Draft from visual research/planning |

No unselected TarikOS content should be fetched merely because the user is editing a Studio document.

### 11.2 Initial quick actions

- Improve writing
- Make concise
- Expand with useful detail
- Change tone
- Create an outline
- Summarize selection
- Extract action items
- Identify assumptions, risks, and open questions
- Draft a brief from selected sources
- Turn selection into a plan
- Ask TarikOS about selection

### 11.3 Structured AI output

The agent must not return arbitrary replacement JSON for the entire document as its default mechanism. It returns validated, limited operations targeted to a known scope/anchor.

```ts
type DocumentAnchor = {
  from: number
  to: number
  selectedTextHash?: string
  sectionHeadingId?: string
}

type DocumentOperation =
  | {
      type: "replaceRange"
      anchor: DocumentAnchor
      content: JSONContent
    }
  | {
      type: "insertAfter"
      anchor: DocumentAnchor
      content: JSONContent
    }
  | {
      type: "setTitle"
      title: string
    }
  | {
      type: "createReference"
      sourceType: StudioReferenceType
      sourceId: string
      suggestedLabel: string
    }
  | {
      type: "createNativeArtifact"
      artifactType: "brief" | "action"
      payload: unknown
    }

type StudioAgentProposal = {
  id: string
  documentId: string
  action: string
  summary: string
  rationale?: string
  inputScope: "selection" | "section" | "document"
  sourceReferenceIds: string[]
  operations: DocumentOperation[]
  warnings: string[]
}
```

The server validates all operations against:

- The authenticated user and document ownership.
- The current document revision/snapshot expected by the proposal.
- The allowed Tiptap schema.
- Maximum sizes, node depth, and operation counts.
- The selected scope boundaries.

### 11.4 Proposal/review experience

1. User selects content or picks scope and submits a quick action/custom request.
2. TarikOS shows the selected scope and attached sources before/during generation.
3. Agent response becomes a **pending proposal**; no document mutation occurs.
4. UI renders a clear before/after diff, plus a prose summary and warnings.
5. User can Accept all, Reject, or—if feasible—accept/reject individual changes.
6. Acceptance applies the operations atomically, saves a pre-acceptance version, records the agent run, and focuses/highlights changed regions.
7. Rejection leaves document content unchanged and stores only minimal run/audit data according to privacy policy.

### 11.5 Agent guardrails

- The agent cannot apply direct document edits without an explicit user acceptance action.
- The agent cannot delete content in v1; it may propose a replacement/deletion diff for review, but the UI must clearly surface removed content.
- The agent cannot create or mutate canonical TarikOS records without a separate confirmation for each artifact mutation.
- If document content changed since the proposal was generated, invalidate/rebase the proposal; never apply it blindly to a changed range.
- AI factual assertions should reference attached sources when available; otherwise label them as synthesis, draft language, or unverified suggestion.
- Model calls and source resolution occur server-side only.

---

## 12. Agent context contract

The client sends element/range identifiers and user intent, not a free-form bundle of all private data. The server resolves authorized data and builds a bounded context packet.

```ts
interface StudioAgentContext {
  document: {
    id: string
    title: string
    documentType: StudioDocumentType
    revisionToken: string
  }
  scope: {
    kind: "selection" | "section" | "document"
    anchor?: DocumentAnchor
    content: JSONContent
    plainText: string
  }
  references: Array<{
    referenceId: string
    sourceType: StudioReferenceType
    sourceId: string
    title: string
    excerpt?: string
    canonicalUrl?: string
  }>
  request: {
    action?: string
    prompt?: string
  }
}
```

Set explicit per-request input and output limits. If a full document exceeds the model-context budget, use a transparent staged workflow: first produce an outline/analysis of sections, then ask the user which portion to modify. Do not silently omit content.

---

## 13. Data model and Convex schema

Adapt names and validators to the actual TarikOS schema conventions after repository review.

```ts
studioDocuments: defineTable({
  ownerId: v.id("users"),
  title: v.string(),
  documentType: v.union(
    v.literal("note"),
    v.literal("draft"),
    v.literal("brief"),
    v.literal("plan"),
    v.literal("decision_record"),
  ),
  status: v.union(v.literal("active"), v.literal("archived")),
  contentJson: v.any(),
  plainText: v.string(),
  excerpt: v.optional(v.string()),
  schemaVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastVersionAt: v.optional(v.number()),
})
  .index("by_owner_updated", ["ownerId", "updatedAt"])
  .index("by_owner_status", ["ownerId", "status"]),

studioDocumentReferences: defineTable({
  documentId: v.id("studioDocuments"),
  nodeId: v.optional(v.string()),
  sourceType: v.string(),
  sourceId: v.string(),
  displaySnapshot: v.any(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_document", ["documentId"])
  .index("by_source", ["sourceType", "sourceId"]),

studioDocumentVersions: defineTable({
  documentId: v.id("studioDocuments"),
  versionNumber: v.number(),
  title: v.string(),
  contentJson: v.any(),
  plainText: v.string(),
  reason: v.string(),
  agentRunId: v.optional(v.id("studioAgentRuns")),
  createdAt: v.number(),
})
  .index("by_document_version", ["documentId", "versionNumber"]),

studioAgentRuns: defineTable({
  documentId: v.id("studioDocuments"),
  ownerId: v.id("users"),
  action: v.string(),
  request: v.string(),
  inputScope: v.string(),
  anchor: v.optional(v.any()),
  sourceReferenceIds: v.array(v.id("studioDocumentReferences")),
  baseRevisionToken: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("invalidated"),
    v.literal("failed"),
  ),
  proposal: v.optional(v.any()),
  model: v.optional(v.string()),
  acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_document_created", ["documentId", "createdAt"]),

studioEvents: defineTable({
  documentId: v.id("studioDocuments"),
  actorType: v.union(v.literal("user"), v.literal("agent")),
  eventType: v.string(),
  payload: v.any(),
  createdAt: v.number(),
})
  .index("by_document_created", ["documentId", "createdAt"])
```

### 13.1 Revision token

Calculate a stable revision token from the normalized document JSON and `updatedAt`, or store an incrementing revision number. Every proposal binds to the revision token from which it was generated. Acceptance must fail safely if the document has changed.

### 13.2 Content validation and migrations

Store a `schemaVersion`. Implement a content normalizer/migration path before loading each document into Tiptap. Include fixtures for historic documents before upgrading Tiptap/extensions.

Never persist arbitrary unvalidated model JSON directly.

---

## 14. Persistence and versioning

### 14.1 Autosave

- Serialize editor updates after a 500–1,500 ms debounce following the last editing transaction.
- Coalesce overlapping writes and protect against out-of-order response overwrite.
- Show `Saving`, `Saved`, `Offline/local changes`, and `Save failed` states.
- Save on navigation/visibility changes when practical.
- Maintain a local browser recovery draft keyed to document ID and revision token.
- On load, reconcile local recovery content with server content transparently; never overwrite server data without user choice when conflict exists.

### 14.2 Versions and restore

- A version snapshot is taken immediately before accepting an AI proposal.
- A restore action creates a new current revision from an old version rather than destructively deleting history.
- Display version date, reason, agent action if applicable, and an optional concise diff/summary.
- Version history is accessible from the right inspector.

---

## 15. Integration with Canvas and TarikOS

### 15.1 Canvas → Studio

From a Canvas selection or frame, user chooses one of:

- Create blank Studio document with selected items attached as sources.
- Draft a Brief from selected items.
- Draft a Plan from selected items.
- Add selected Canvas frame/reference to an existing Studio document.

Canvas sends only explicit selected board elements/references. Studio stores the Canvas and element/frame references. The agent’s prompt must state the exact selected source scope.

### 15.2 Studio → Canvas

From Studio, user can:

- Add the document as a Canvas reference card.
- Add a selected section as a Canvas note/reference card.
- Create a Canvas for a document, with the document card and optional frames for research, outline, decisions, and actions.

### 15.3 Existing TarikOS entities

- Conversations: insert as source cards or create a document from a selected conversation/excerpt.
- Briefs: **DECIDED 2026-08-11 — Studio links, it never owns.** The `briefs` table stays the single canonical brief store: the 07:00 workflow writes it, `/briefs` renders it, `get_brief` and `find_brief` read it, and `send_brief_digest` mails it to Telegram. A Studio document of `documentType: "brief"` is a *draft that references* a brief record, never a second one. Studio may propose a `createNativeArtifact` of type `brief`, which writes to that same table behind its own confirmation — it does not create a parallel representation. The reason is that "what's my brief" has exactly one true answer today, and a second store makes every reader — voice, dashboard, digest, search — pick between two. Studio bends to the existing shape; the shape does not fork for Studio.
- Telos: link goals/objectives and create plan documents anchored to a goal.
- Habits: link habit context, but do not make Studio responsible for habit tracking.
- Mail: use references or extracted items with strict authorization; do not bulk expose mail content.

---

## 16. Architecture

### 16.1 Constraints

TarikOS is an existing Next.js/TypeScript application with Convex and an Anthropic SDK dependency. Studio must use established app patterns for auth, styling, server endpoints/actions, and data access. Do not add Supabase, LangGraph, LangSmith, a second database, or a separate collaboration service for Studio v1.

Open Canvas may inform UX patterns, but it must not be embedded wholesale because it has independent authentication, agent/runtime, and persistence assumptions.

### 16.2 Suggested code layout

```text
src/
  app/
    studio/
      page.tsx                         # Document index
      [documentId]/
        page.tsx                        # Editor workspace
  components/
    studio/
      StudioEditor.tsx
      StudioToolbar.tsx
      StudioBubbleMenu.tsx
      StudioInspector.tsx
      StudioSourcesPanel.tsx
      StudioVersionPanel.tsx
      StudioAIPanel.tsx
      StudioProposalReview.tsx
      StudioReferenceNode.tsx
      StudioCreateDialog.tsx
  lib/
    studio/
      types.ts
      editor-schema.ts
      document-json.ts
      serialization.ts
      references.ts
      revision.ts
      agent-context.ts
      proposal.ts
      diff.ts
convex/
  studioDocuments.ts
  studioDocumentReferences.ts
  studioDocumentVersions.ts
  studioAgentRuns.ts
  studioEvents.ts
```

### 16.3 Client/server responsibilities

| Responsibility | Location |
|---|---|
| Tiptap editor, selection state, local editor transactions, formatting UX | Client component |
| Auth checks, document/source resolution, agent prompt/context build | Server / Convex action/API pattern |
| Anthropic calls, structured output validation | Server only |
| Convex writes for documents, versions, references, runs, events | Convex mutations/actions |
| Proposal diff rendering and accept/reject controls | Client, backed by server mutation |
| Schema migrations/normalization | Shared trusted library + server validation |

### 16.4 Secure rendering

Tiptap content may be rendered server-side or client-side. Any HTML derived from stored content must be sanitized and rendered using a safe allowed-node/allowed-attribute policy. Do not use unsanitized `dangerouslySetInnerHTML` for imported or model-provided HTML.

---

## 17. Functional requirements

### FR-1: Document CRUD

- User can create a document with type, title, and optional initial template.
- User can list active documents they own.
- User can rename, archive, restore, and permanently delete a document.
- Permanent deletion requires explicit confirmation and follows TarikOS data-retention conventions for versions and events.

### FR-2: Rich-text editing

- User can edit all supported Tiptap content types naturally with mouse and keyboard.
- Common shortcuts work: headings, bold/italic, lists, undo/redo, link insertion.
- Content survives reload with structure intact.
- The editor displays accurate save status.
- Invalid document payloads do not crash the workspace; show a recoverable error state and preserve raw data for support/recovery.

### FR-3: References

- User can insert a TarikOS reference through a searchable picker.
- User can attach sources at document level without inserting inline nodes.
- Reference nodes/entries open canonical sources.
- Display snapshots may refresh without overwriting local document prose/annotations.
- User can remove a reference from Studio without deleting the source TarikOS record.

### FR-4: AI proposals

- User can invoke initial quick actions against explicit scope.
- Agent proposal is stored but does not mutate document content before approval.
- User can accept or reject each proposal.
- Acceptance checks document revision and source authorization again.
- Accepted proposals create an auditable agent run and version checkpoint.
- Rejected proposals do not alter document content.

### FR-5: Version history

- User can create a manual version.
- User can view versions in chronological order.
- User can restore an earlier version via confirmation.
- Restore creates a new version/event rather than mutating/deleting old history.

### FR-6: Canvas interoperability

- User can create a document from explicit Canvas selection/frame context.
- User can add a Studio document or selection to a Canvas as a reference.
- Cross-links are durable and survive document/canvas reloads.

---

## 18. Non-functional requirements

- **Privacy:** Source context is bounded, selected, authorized, and processed server-side.
- **Performance:** Avoid serializing/persisting the full editor state on every keystroke. Typical personal documents should load and edit smoothly.
- **Reliability:** User edits should not be lost during normal reload/navigation; local recovery protects against temporary network failure.
- **Accessibility:** Toolbar, menus, dialogs, AI panel, source list, and proposal controls are keyboard-accessible and semantically labeled. Maintain readable contrast and focus indicators.
- **Observability:** Track document load/save failures, editor content validation failures, proposal lifecycle, version restores, and agent error rates without logging unnecessary private content.
- **Testing:** Unit-test schema validation, JSON normalization, revision conflict detection, source authorization, proposal validation, and conversion utilities. End-to-end test basic write/reload, proposal accept/reject, version restore, and Canvas handoff.

---

## 19. Acceptance criteria

### Foundation

- [ ] Authenticated user can open `/studio`, create a document, and reopen it later.
- [ ] Title and rich text persist through reload with headings, lists, tasks, links, and reference nodes intact.
- [ ] Save status accurately represents pending/success/failure conditions.
- [ ] Autosave avoids data loss under normal editing and navigation.

### References

- [ ] User can insert at least Canvas, Conversation, Brief, and Telos references.
- [ ] Clicking a reference opens the canonical source.
- [ ] A source snapshot refresh does not overwrite user-authored content.

### AI workflow

- [ ] Selection rewrite uses only explicit selected content and attached sources by default.
- [ ] AI proposal is visible as a diff before document mutation.
- [ ] Reject leaves editor state unchanged.
- [ ] Accept applies validated changes atomically and creates a document version.
- [ ] Accepting an outdated proposal after manual document changes fails gracefully and asks the user to regenerate/review.
- [ ] Inspector shows action, date, source scope, and relevant agent run for accepted changes.

### Versioning and interoperability

- [ ] User can manually create and restore a version.
- [ ] Creating a document from a Canvas selection preserves source links.
- [ ] A Studio document can be linked back to a Canvas.

### Safety

- [ ] Unauthorized document/source/reference IDs are rejected server-side.
- [ ] AI cannot silently mutate Studio content or canonical source records.
- [ ] Model-generated content is schema-validated before rendering/persistence.

---

## 20. Delivery plan

### Phase 0: Repository discovery

- Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `README.md`, `package.json`, existing Convex modules, auth flow, Anthropic integration, Briefs, Conversations, Telos, and Canvas implementation status.
- Identify actual entity names/IDs and existing design-system conventions.
- ~~Decide whether Studio v1 introduces a new canonical Brief representation or adapts/links existing Briefs.~~ Decided 2026-08-11: links. See §15.3.
- Tiptap 3.29 (`@tiptap/react`, `starter-kit`, `extension-link`) is ALREADY a dependency and already in use in `src/app/mail/Compose.tsx`. Match its configuration and styling rather than introducing a second setup.
- Confirm attachment and storage capabilities before enabling Tiptap Image.

### Phase 1: Persistent Tiptap documents

- Install/configure Tiptap core and selected extensions.
- Implement Convex document schema, ownership checks, and content validation/normalization.
- Build Studio index and editor routes.
- Implement title editing, templates, debounced autosave, local recovery, archive/delete.
- Add manual versions.

### Phase 2: TarikOS references and Canvas handoff

- Implement document reference schema and searchable source picker.
- Implement `TarikOSReference` node and document-level source panel.
- Add source entry points from primary TarikOS entities.
- Add Canvas → Studio document creation and Studio → Canvas reference actions.

### Phase 3: AI proposal workflow

- Implement selection/section/document scope capture.
- Build server-side context resolution and Anthropic structured output integration.
- Implement proposal persistence, schema validation, and revision-token conflicts.
- Add diff/review UI and accept/reject workflow.
- Ship initial quick actions.

### Phase 4: Hardening

- Improve version UI and restore flow.
- Add instrumentation, tests, accessibility review, performance safeguards, migration fixtures, and documentation.
- Refine document templates and visual design based on personal use.

---

## 21. Open questions

1. ~~What exact existing TarikOS entity/schema represents a Brief? Should Studio documents with `documentType: "brief"` replace it, synchronize with it, or link to it?~~ **ANSWERED 2026-08-11.** The `briefs` table in `convex/schema.ts` (title, workflowName, status, runStartedAt, sections[]). Studio **links** — see §15.3. Note the name collision: an unrelated `documents` table already exists for saved R2 files and their share links, so Studio's document table needs a different name.
2. What exact user/auth table and ownership utility does TarikOS use in Convex?
3. Is the current Anthropic layer capable of structured outputs/tool use and streaming? Reuse it where it fits; do not add a parallel agent framework.
4. What package/version conventions exist for rich-text or UI components already? Avoid conflicting editors or CSS resets.
5. How much version history should a private document retain, and when should snapshots move to storage rather than Convex documents?
6. Is full document search already implemented? If not, should Studio v1 only support title/excerpt search until a proper indexing approach exists?
7. Are documents meant to support attachments in v1, or should images/files wait until storage permissions, deletion lifecycle, and rendering are established?
8. Should agent suggestions have a temporary in-editor “suggestion” visual mode, or is a side-by-side/inline proposal review sufficient for v1?
9. Does the user want code-rich documents later? If so, keep code block extensions but postpone executable previews and language services.

---

## 22. Implementation instructions for Claude Code

1. Treat this PRD as product intent. Read the existing TarikOS documentation and code before proposing file changes; repository patterns and actual entity names control implementation details.
2. First produce an architecture note that maps this PRD’s proposed data types to actual TarikOS routes, Convex schemas, auth utilities, agent service, and design components.
3. Use Tiptap for direct user editing. Persist valid Tiptap JSON as canonical content. Do not make Markdown the primary editor or primary content store.
4. Do not import/merge the Open Canvas application as a dependency. It is a reference for product patterns, not the Studio v1 runtime architecture.
5. Do not introduce Supabase, LangGraph, LangSmith, Yjs/Hocuspocus, Tiptap Cloud, a second database, or a new standalone backend for this version.
6. Keep all AI calls and source-record resolution server-side. The browser only sends intent, selection anchors, reference IDs, and document identifiers.
7. Validate model outputs using a strict schema and validate/normalize generated Tiptap JSON against the enabled editor schema before preview or persistence.
8. Bind every AI proposal to a document revision token; fail closed if the document changed before acceptance.
9. Build in reviewable increments: document foundation, editor persistence, references, Canvas interop, AI proposals, versions/tests.
10. Before declaring a phase complete, run typecheck, lint, relevant unit tests, and manual browser checks for edit/reload, error recovery, AI proposal rejection, acceptance, and version restore.
11. Document environment requirements, schema migrations, extension configuration, accepted content schema, export behavior, and known limitations in the repository.

---

## 23. Future opportunities (not v1)

- User-editable writing preferences inferred from accepted/rejected changes, with full review/delete control.
- AI suggestions as track-changes style inline decorations.
- Tiptap collaboration/Yjs only if TarikOS moves beyond a private single-user app.
- Comments, annotations, and document review workflows.
- DOCX/PDF import/export and print-quality formatting.
- Rich citations/bibliography management.
- Code-aware documents and implementation-spec generation.
- Canvas-generated research reports and Studio-generated visual summaries.
- Document templates for civic research, music journalism, product requirements, project plans, and decision records.
