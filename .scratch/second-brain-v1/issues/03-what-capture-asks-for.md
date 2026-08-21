# 03 — What capture asks for at the moment of capture

Type: grilling
Status: open
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
