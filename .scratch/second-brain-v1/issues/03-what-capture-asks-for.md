# 03 — What capture asks for at the moment of capture

Type: grilling
Status: resolved
Blocked by: 01

## Question

`capture_memory` in the PRD takes kind, area, project, source, and confidence. Every field
is a decision made at the exact moment the goal is zero friction — and voice is the front
door, so this is the hottest path in the system.

The competing designs: **classify at capture** (Zola asks, or guesses and asks to confirm),
or **capture raw and classify later or never** (store the sentence with its provenance,
let recall do the work).

The second is closer to how the existing `memories` table already behaves, and closer to
what embeddings make possible — retrieval no longer needs the human to have filed well.

What does Zola actually ask for out loud, and what does she infer silently? Note the
existing rule that inferred things become proposals — if classification is inferred, every
capture generates a review item, which collides with ticket 05.

## Answer

**Capture asks for nothing. It already works that way, and the job is not regressing it.**

The live tools settle most of this. `remember` takes only a `type`, which Zola picks
silently from four values; `capture_thought` takes tags and items and never interrogates.
Neither has ever asked Tarik to file anything, and capture friction is the documented first
cause of death for these systems, so that behaviour is the thing to protect.

The PRD's `capture_memory` signature is already smaller than it looks. Ticket 01 removed
`area` (it became a tag). Ticket 02 removed `confidence` (nothing is inferred, so every
capture is explicit). What remains is what exists today.

**Two new verbs, neither of which asks either.**

*Open loop* is the sentence, nothing more. A person or a date is taken only if Tarik said
one; otherwise those fields stay empty. She never prompts for them — the whole point of the
type is that it is the thing with no date and no email.

*Decision* is the one with a real design problem: a decision without a rationale is just a
fact, so the "why" carries the value, but demanding it is exactly the interrogation that
kills capture. The resolution is that **she writes the rationale from what he just said and
reads it back once** — "Saved: the portfolio is the main proof of AI product work, because
the case study lands better than a résumé line. Right?" That is a confirmation, not a
question. He says yes or corrects one clause.

**The governing rule: she never asks for something she could take from what he just told
her.** Everything in the preceding turns is available; asking for it again is a tax on
being talked to.

**Why guessing is safe.** Recall runs on embeddings, so records are findable whether or not
they were filed correctly. A decision misclassified as a memory costs almost nothing. That
cheapness is precisely what licenses guessing over asking — the classic filing tax exists
to serve human retrieval, and human retrieval is not how this system is read.

**Undo, not approval.** She says the record back, it is saved, and undo is available. The
existing house rule stands: she never claims something was saved unless the tool returned
success.
