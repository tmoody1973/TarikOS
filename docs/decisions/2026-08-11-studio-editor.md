# Choosing the editor for Studio

**Decision record · 2026-08-11 · Tarik OS**
**Status:** Decided — Plate

---

## Context

Studio is a writing workspace inside Tarik OS: a place to draft briefs, plans
and decision records with an AI collaborator, where the finished document stays
linked to the research it came from.

Everything in it sits on one choice — which rich-text editor. The editor decides
what a document *is* in the database, which decides what versions, restore,
references and AI proposals can be built on. Get it wrong and four phases of work
sit crooked on it.

Two requirements were stated up front:

1. **Notion-style writing** — blocks you can drag, a slash menu, a document that
   feels like a document.
2. **Export to DOCX and PDF.**

Two constraints came from the system, not the wish list:

- **The repo is public under MIT.** Anything that forces a relicense is out.
- **The design system forbids component libraries** for visual primitives —
  everything is hand-rolled Tailwind on a fixed token set.

## Options

| | Notion-style | DOCX export | PDF export | License |
|---|---|---|---|---|
| **Plate** | Yes — drag handles, slash menu, block AI menu | **MIT, free** | Weak client-side | MIT |
| **BlockNote** | Best out of the box | **GPL-3.0 or ~$90/mo** | Same paywall | Forces a choice |
| **Tiptap** | Would have to be built | Paid | Would have to be built | MIT core |
| **Quill** | No — flat Delta format, no block model | No | No | MIT |

Two adjacent options were also evaluated and rejected:

- **Liveblocks** — collaboration infrastructure under whichever editor you pick.
  Their own docs: *"Liveblocks is the primary source of truth for your
  collaborative documents."* Your own database becomes a replica fed by
  webhooks. For a single-user app that is a second store of the canonical
  document in exchange for features one person cannot use. Convex is already a
  realtime database.
- **Keeping Tiptap**, which was already installed and working in the mail
  composer. Rejected on the DOCX requirement, not on quality.

## Decision

**Plate**, for Studio only. Mail keeps Tiptap for now.

The decision came down to two lines read off the npm registry rather than off a
documentation page:

```
@platejs/docx-io              license = MIT
@blocknote/xl-docx-exporter   license = GPL-3.0 OR PROPRIETARY
```

BlockNote is the better Notion-style editor out of the box. Its DOCX exporter is
dual-licensed: GPL-3.0, or a commercial subscription. Taking the free door would
make the combined work GPL-3.0 and relicense a repo that is deliberately MIT.
Paying is $90+/month for one person's writing app.

Plate clears both requirements at MIT, and its shadcn-registry install writes
component *source* into the repo rather than importing a package — so the
components can be restyled outright, which the design system requires anyway.

**Document storage: the editor's own JSON tree, not markdown or HTML.**
Every candidate says the same thing in its own API. BlockNote names its text
exporters `blocksToMarkdownLossy()` and `blocksToHTMLLossy()` — *lossy is in the
function name* — and calls JSON "the recommended lossless format for storage."
Tiptap's markdown pipeline is `Markdown → JSON → HTML`; the tree is the middle,
and both text formats are edges. Markdown and HTML are exports, not storage.

## Consequences

**Accepted:**

- Two editor engines in one app — Plate (Slate) in Studio, Tiptap (ProseMirror)
  in mail. Migrating mail is a contained follow-up *if* Plate earns it over a few
  weeks. Rewriting a deployed email path for symmetry, before the new editor has
  proven anything, trades a working feature for tidiness.
- Slate rather than ProseMirror as the foundation, with its own trade-offs.
- shadcn-derived component source in the repo, to be restyled to the LCARS
  palette rather than themed around.

**Unresolved by this decision:**

- **PDF is a wash across all four options.** Plate's client-side export is
  `html2canvas` + `pdf-lib` — it screenshots the editor and embeds the picture.
  Their own docs say it is "not for paginated print layout." Real PDF means a
  print stylesheet or headless Chrome, both of which work with any editor and
  neither of which should have influenced this choice.

## Addendum, same day: the AI kit

Tarik found `@platejs/ai` after the decision was made, and it is a bigger part
of the answer than the choice was made on.

It is MIT, and it ships the mechanism the PRD spent its longest section
specifying: an AI menu on ⌘+J, chat mode that shows a **review panel with a
diff before anything is applied**, `tf.aiChat.accept()` to apply and a discard
to reject, and three scopes — cursor, text selection, block selection. That is
the propose → review → accept contract, already built and already tested by
other people.

It does not supply the parts that make it *this* system: grounding a request in
the sources attached to the document, recording which run produced an accepted
change, and refusing a proposal whose document moved while the model was
thinking. Those stay hand-built, and they are the interesting half.

Worth recording that this was found by the user reading a feature page, not by
the evaluation. The evaluation optimised for licence and export and treated the
AI menu as a bullet — which is how the most valuable property of the winning
option went unnoticed until after the decision. **Choosing on two requirements
means the third is unexamined even when the choice happens to be right.**

## What I got wrong on the way here

Three recommendations, in order, each reversed by evidence:

1. **"Stay on Tiptap — alternatives ship a Notion look you'd have to remove."**
   Overstated. BlockNote themes through CSS variables; colours, radius and font
   can all move. What stays theirs is the *shape* of the UI, not the palette.
2. **"Studio should distinguish a live reference from an ordinary link."**
   Killed by the right question: *why would it need to tell them apart?* For a
   single user, a link to a record is a source. Making someone declare which
   links are Special is bureaucracy invented to justify a data model.
3. **"Plate's DOCX export is free"** — asserted from one docs page while another
   marked it Plate Plus. The pages contradicted each other. `npm view` settled
   it, and that is where the licence question should have started.

The pattern across all three: **the marketing page, the docs page and the package
metadata disagree, and only one of them is the software.** Check the artefact.

---

*Written before Studio existed, in the format Studio will use for decision
records: context, options, decision, rationale, consequences.*
