# 10 — Does anything get backfilled into the new stores

Type: grilling
Status: open
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
