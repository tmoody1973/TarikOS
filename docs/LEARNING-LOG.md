# Learning log

Dated entries. Each answers three things: what we expected, what happened, what we now believe.
Decision records live in `docs/decisions/`. This file is the running retro.

---

## 2026-09-22 · Accents on GPT-Live's built-in voices

**Expected:** OpenAI's custom-voices guide says to name an accent in the session instructions
("Speak British English"). We assumed the same line would steer a built-in voice like Shimmer
toward South African English.

**What happened:** Added "Speak South African English." to the voice instructions and tested
Shimmer on the production `/talk-live` page. No accent at all.

**What we now believe:** Each built-in voice carries a fixed accent. The docs' voice table lists
a "regional influence" per voice (Australian, British, Irish, North American, Southern US,
Brazilian Portuguese, Filipino), and the accent instruction is documented only for custom
voices, where the model copies a real recording. A South African Zola means recording a South
African speaker as a custom voice. A British Zola today means Vesper, the one built-in British
voice, which is masculine.

## 2026-09-22 · Which id ties a GPT-Live tool call to its completion

**Expected:** In Responses delegation, the nested `response.output_item.done` (the finished
function call) and the nested `response.completed` would share a response id, so the browser
could collect calls under that id and run them when the response finished.

**What happened:** First live test: "what's on my calendar" produced dead silence. Production
logs showed the session start and nothing else; the tool route was never hit. A scripted
session showed why: `output_item.done` has no response id at all, only `item`,
`output_index` and `sequence_number`. `response.completed` does carry one. The two were
filed under different keys and the call was never released.

**What we now believe:** The `delegation_id` on the outer `response.event` envelope is the
key both events share, and it is what the docs mean by "preserve the outer delegation_id".
Keyed that way, the same script ran the real calendar tool and the backend answered with the
day's events. Also learned: a text-only WebSocket session with a typed message is a fast,
mic-free way to see the exact event sequence before trusting a browser test.
