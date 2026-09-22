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
