# 06 — What Zola says when the answer is weak

Type: grilling
Status: resolved
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

## Answer

**The strength of the claim must match the strength of the record — and the rarest, most
important sentence she owns is "nothing on that."**

Two of the four cases this ticket was written against no longer exist. Ticket 02 removed
inference from v1, so "the best record is a hypothesis she formed" cannot happen; and since
derived and stated edges are both speakable as fact, there is no distinction to voice
between them. Three cases remain.

**1. The record is past its shelf life.**

> "You decided in March the portfolio was the main proof. That's five months old and you
> haven't touched it since — still true?"

State it, date it, name the doubt, ask once. This is the confirmation-on-use behaviour that
ticket 04 chose, rendered as words.

**2. Two records disagree.**

> "Two answers, and they disagree. In March you said the portfolio; in June you said the
> case study. June's newer — is that the one?"

Name both, say which is newer, do not quietly pick. This is the existing house rule (never
choose between two matches) applied to recall rather than to threads.

**3. She has nothing. This is the case that will actually cause harm.**

**Embeddings never return empty.** A vector search asked a question it has no answer to does
not report absence — it returns the nearest row in the index. When no relevant record
exists, the nearest row is noise, and noise delivered with a citation is worse than silence
because it sounds researched. This is the specific way a second brain becomes untrustworthy,
and nothing in the PRD guards against it.

So recall needs a **similarity floor**, below which the answer is nothing, and she must be
willing to say so:

> "Nothing on that. Closest I have is the portfolio decision, which isn't the same thing."

**Order matters.** The "no" comes first; the near-miss follows, explicitly labelled as a
near-miss. Leading with the near-miss reads as an answer no matter how it is qualified.

**4. She knows. Then she says it, with no hedge at all.**

Hedges only carry information while they are rare. If every answer is prefixed with "I
think", the prefix stops meaning anything and he learns to skip it — at which point the
hedge on the one answer that genuinely needed it does no work. Qualifying everything and
qualifying nothing fail the same way.

**Implementation note:** the floor is a real number that has to be chosen against real
queries, not guessed. That is a tuning task, not a decision, and it belongs to
implementation rather than to this map.
