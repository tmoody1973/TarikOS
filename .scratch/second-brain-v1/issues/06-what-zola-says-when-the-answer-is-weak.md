# 06 — What Zola says when the answer is weak

Type: grilling
Status: open
Blocked by: 01, 02

## Question

The stated pain is "Zola didn't know something she should have", so recall *with authority*
is the point of v1. The hard cases are not the confident ones.

Decide her spoken behaviour for each:

- The best record is `agent_inference` — a hypothesis she formed, never confirmed.
- The best record is stale — true once, unverified for months.
- Two approved records disagree.
- She has nothing, but embeddings return something adjacent.

The PRD says "do not state inferred or stale information as fact" and "return a conflict
indicator", which is a rule, not a sentence. This ticket produces the actual words, because
on a voice interface the phrasing *is* the feature — the difference between "you decided X"
and "I think you leaned toward X, but you never confirmed it" is the entire trust model.

Constraint from the existing persona: one to three sentences, no lists, spoken aloud.
