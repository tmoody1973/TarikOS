# 10 — Does anything get backfilled into the new stores

Type: grilling
Status: resolved
Blocked by: —

## Question

Graduated from the fog. Migration was unanswerable while the node types were unsettled;
ticket 01 settled them, and most of the question dissolved — the ten inherited types are
pointers, so nothing moves and nothing is copied.

What remains is the two native stores, which start empty:

- **`decision`** — there are real decisions already recorded in this repo, in
  `docs/decisions/` (three at time of writing, in Tarik's own decision-log practice) and
  scattered through 500-plus conversation transcripts.
- **`open_loop`** — arguably already present as `reminders` without dates, and as whatever
  `reply_zero` surfaces that is not email.

The decision: does v1 start cold, or does something backfill?

Cold is honest and free, and the store fills as he talks. Backfilling from transcripts means
an extraction pass over historical conversations — which is exactly the kind of inferred,
unreviewed bulk write that ticket 02 ruled out for live capture, so allowing it here needs a
reason for why history is different.

The `docs/decisions/` files are a narrower and stronger case: they are user-written, already
approved, and few enough to import by hand.

## Answer

**Nothing is backfilled. The stores start cold.** (Tarik: he asks about recent decisions,
not old ones.)

The question dissolved rather than being traded off. Backfilling only matters if the empty
store is a problem, and it is not: he asks "what did I decide about X" about recent things,
so the store fills at exactly the rate he needs it. A decision made three months ago that he
never asks about costs nothing by being absent.

That also spares the harder argument entirely. Mining old transcripts for decisions would
mean Zola guessing which passages were decisions — the inference that ticket 02 ruled out for
live capture. There is a real case that history is different (when he is talking to her, an
inferred memory competes with simply asking him; for a March conversation he is not there,
and the alternative is losing it) but it never has to be made, because the empty store was
never the problem it appeared to be.

Worth recording what was found while checking: **nightly consolidation has been reading every
transcript since it shipped, but its schema only extracts `new_memories`, `updates`,
`deletes` and `telos_updates`.** Decisions are not in it. So the transcripts have been mined
for facts and never for decisions — the material is genuinely there and genuinely
unextracted. That does not change the answer, but it means the option stays open if the
premise ever changes.

**The three files in `docs/decisions/` are a separate and much smaller case.** They are
hand-written, already approved, and there are three of them. Importing them is copying, not
inference, so it does not conflict with ticket 02 — but it is optional and trivially
reversible either way. Left to taste rather than decided here.
