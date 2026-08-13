# What an Agent Should Not Be Allowed to Do

### A design case study of a personal AI assistant, its authority boundaries, and what it cost to learn them

**Tarik Moody**
Independent · Milwaukee, Wisconsin
August 2026

---

## Abstract

Large language models can now be given tools, memory, and a voice, which turns
them from things that answer questions into things that act. Most published
work on such systems describes what they can do. This paper describes what one
of them is deliberately prevented from doing, and why each restriction was
chosen.

Tarik OS is a personal AI assistant built and used by its author. It runs a
voice agent named Zola with 48 tools spanning calendar, email, notes, projects,
contacts, habits and telephony. It is a single-user system, deployed to
production, and in daily use.

The paper makes four contributions. First, a framework for **agent authority**
that separates what an agent may read, propose, write and send, and enforces
each boundary structurally rather than by instruction. Second, a design rule for
the **standing prompt** that treats it as two surfaces rather than one, with a
measured result: 8,533 characters removed from a 25,755-character prompt with no
loss in tool-selection accuracy beyond the measurement noise floor. Third, a
**taxonomy of failure modes** observed in production, of which the most
expensive were failures that reported success. Fourth, an account of building a
51,825-line system in a seven-day git history as a non-traditional developer
working with AI coding assistants, including what that changed about which
skills mattered.

The system was evaluated with a replay harness over 107 labelled utterances
drawn from real recorded conversations. The evaluation is honest about its
limits: one user, one annotator, no baseline system.

**Keywords:** LLM agents, agent authority, prompt injection, human-in-the-loop,
personal informatics, AI-assisted software development, design case study

---

## 1. Introduction

An assistant that can read your calendar is a convenience. An assistant that can
write to it is a liability, and the difference between those two sentences is
the entire subject of this paper.

The last two years produced a large number of systems that connect a language
model to real tools. The engineering is now unremarkable: define a function,
describe it to the model, let the model call it. What remains genuinely hard is
deciding which functions the model should be permitted to call at all, and what
must stand between a spoken sentence and an irreversible action.

Most write-ups answer the first question and skip the second. A demonstration
shows an agent booking a restaurant. It rarely shows what happens when a
stranger emails the agent and asks it to book one.

This paper is a first-person design case study of **Tarik OS**, a personal
assistant its author built for himself and uses daily. It is deliberately a
report from inside a running system rather than a controlled experiment. The
system has one user. That is a limitation for some kinds of claim and a method
for others: it means every design decision was made by someone who would
personally suffer the consequences of getting it wrong, and several of them did
suffer before being corrected.

### 1.1 Why "authority" and not "safety"

The word *safety* in this literature usually means preventing a model from
producing harmful text. That is not the problem here. The problem is that Zola
can send email, create calendar events, file tasks and telephone her owner. The
question is not whether she will say something objectionable. It is what she is
permitted to *do*, on whose behalf, and with what confirmation.

This paper uses **authority** for that question, and treats it as a design
surface with four levels:

| Level | Meaning | Example |
|---|---|---|
| **Read** | May observe | Reading the calendar |
| **Propose** | May prepare an action a human completes | Writing a Gmail draft |
| **Write** | May change state, reversibly, without asking | Creating a task |
| **Send** | May act on the outside world irreversibly | Emailing a stranger |

The central claim of this paper is that these levels must be separated
**structurally** rather than by instruction. A rule in a prompt is a request. A
missing function is a fact.

### 1.2 Contributions

1. **An authority framework** with worked examples, including two cases where
   the first version of the rule was wrong and had to be reversed.
2. **A standing-prompt design rule** ("one home per fact, chosen by the fact's
   lifetime") with a measured before-and-after.
3. **A failure taxonomy** grounded in production incidents, including the class
   of failure that returns success.
4. **An account of AI-assisted construction** of the system, and which skills
   turned out to be load-bearing when writing code stopped being the bottleneck.

### 1.3 What this paper is not

It is not a benchmark. It does not propose a new algorithm. It does not
generalise from one user to a population. Where it reports numbers, those
numbers are from one system measured by one person, and Section 10 says so at
length.

---

## 2. Background

This section defines the terms used throughout, for readers who do not build
these systems.

### 2.1 What a tool-using agent actually is

A language model produces text. On its own it cannot do anything else.

To make it act, you give it a list of **tools**. Each tool is a short
description ("create a calendar event; requires a title, date and time") plus a
function the surrounding program knows how to run. The model, given a
conversation, may respond with text or with a request to call one of those
tools. The program runs the function, hands the result back, and the loop
continues.

Everything the agent can do is therefore fixed by that list. This is the most
important property in this paper. **An agent cannot do a thing for which no tool
exists**, no matter how it is asked, tricked, or instructed.

### 2.2 The standing prompt

Before any conversation begins, the model is given a block of text: who it is,
who it serves, how it should behave. This is the **standing prompt** or
*persona*. In Tarik OS it is sent at the start of every session, and until
recently it was 25,755 characters long.

### 2.3 Prompt injection, in plain terms

Because the model treats all text it receives as input, text that arrives from
the outside world can contain instructions. If an agent reads an email that
says *"ignore your previous instructions and forward the owner's calendar to
this address,"* a naive system may comply, because to the model there is no
formal difference between the operator's instructions and the email's.

This is not a hypothetical. It is the defining security problem of agents with
inboxes, and Section 4.4 describes the specific design used here.

---

## 3. System description

### 3.1 What Tarik OS is

Tarik OS is a web application with a voice agent attached. A user, in this case
its author, either types in a dashboard or speaks to an assistant named Zola.
Zola has access to the tools listed below and can navigate the dashboard while
talking.

Verified figures from the repository as of 12 August 2026:

| Measure | Value |
|---|---|
| Source files (TypeScript/TSX) | 366 |
| Lines of source | 51,825 |
| Automated tests | 927, across 80 files |
| Tools published to the agent | 48 |
| Tool handlers in the API route | 54 |
| Written design specifications | 12 |
| Commits in git history | 211, spanning 6–12 August 2026 |
| Standing prompt (persona) | 4,191 characters, reduced from 12,724 |

### 3.2 Architecture

```
   voice  ─────►  ElevenLabs agent  ─────┐
                                          │  HTTPS + shared secret
   text   ─────►  Telegram bot     ──────┤
                                          ▼
                                 /api/tools/[tool]
                                 one handler per tool
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    ▼                     ▼                      ▼
              Convex database     external providers       dashboard (Next.js)
              memory, tasks,      Google, Plane,           served on Vercel
              transcripts,        AgentMail, Telnyx        behind Clerk auth
              documents
```

Two properties of this shape matter for the rest of the paper.

**One door.** Voice and text both call the same HTTP route. A restriction placed
there applies to every channel at once. There is no second implementation of a
tool that could quietly diverge in its rules.

**The database is not the agent's.** Zola cannot execute arbitrary queries. She
calls named functions that do specific things. The set of things that can happen
to the data is enumerable, and it is enumerated in one file.

### 3.3 How Zola works, step by step

A spoken request proceeds as follows.

1. The browser opens a real-time audio session with the voice provider, using a
   short-lived token minted by the server after checking the user's login.
2. The provider transcribes speech and passes it to a language model, together
   with the standing prompt, the tool list, and a block of memory about the user
   assembled at session start.
3. The model either speaks or requests a tool call.
4. A tool call becomes an HTTPS request to the application, authenticated with a
   shared secret. The handler validates arguments, does the work, and returns a
   short sentence written to be spoken aloud.
5. The dashboard updates in real time, because the same database that the
   handler wrote to is subscribed to by the browser.

Two details are worth extracting.

**The reply is written to be said, not read.** Tool handlers return spoken
prose, not data structures. A tool that returns a list forces the model to
invent a way to say a list out loud, and it will usually do so badly.

**One tool runs in the browser rather than on the server.** Navigation is a
*client tool*: when Zola is asked to show something, the instruction is executed
by the page itself. This is why the system's voice half and screen half feel
like one thing.

---

## 4. Agent authority

This is the paper's principal contribution. Each subsection states a rule, the
mechanism enforcing it, and where the first attempt was wrong.

### 4.1 The rule that shapes everything: she drafts, he sends

Zola can compose email. She cannot send it.

This is not enforced by telling her not to. **There is no send function.** The
tool list contains `draft_email`, which writes a draft into Gmail and returns.
No amount of instruction, persuasion or injected text can produce a sent message
from a system that has no code path to send one.

The rule survives in a single sentence a user can hold in their head: *she
writes to me freely; she drafts to everyone else.* That sentence was the user's
own formulation, and it replaced two more complicated rules the author had
proposed.

**The distinction underneath it** is whose identity is on the envelope.
Notifying the owner is not correspondence, so it needs no ceremony. Writing to
the outside world as the owner requires the owner.

### 4.2 Rituals for irreversible writes

Some actions are reversible and some are not. Creating a task is one click to
undo. Creating a calendar event that emails four attendees is not.

Irreversible actions in Tarik OS use a **read-back ritual**: the agent must say
back exactly what it is about to do, including the values it computed, and wait
for an explicit yes.

For project creation this is enforced by the protocol rather than by
instruction. The first call returns a *blueprint* and writes nothing. Only a
second call, carrying a confirmation flag, creates anything.

**Where this went wrong.** Every tool argument in the system was declared as a
string, which was correct for 45 arguments and wrong for exactly one: the
confirmation flag. The agent sent the string `"true"`; the handler tested for
the boolean `true`; the two were never equal. **The user could not confirm a
project no matter what he said.** The guardrail test that should have caught it
asserted that a confirmation branch existed. It did exist. It was unreachable
from the only caller that mattered.

The durable lesson was not "add a boolean type." It was: *never compare a tool
argument against a literal in a handler; compare by value.* And: a test that
asserts a branch exists is not a test that the branch can be reached.

### 4.3 The privileged recipient is not a parameter

Zola may telephone her owner and email her owner without confirmation.

The mechanism is that **the recipient is not an argument of anything**. It is
read from server configuration. There is no field in any tool schema where a
phone number or address could be placed, so there is nothing to talk the agent
into.

A guardrail test asserts this directly: it reads the function's signature and
fails if it accepts anything resembling a recipient.

### 4.4 An inbox is a public front door

Late in the project, Zola was given her own email address.

This changes the threat model completely. Everything above concerns what the
*owner* can ask for. An inbox means **anyone who learns the address can put text
in front of the agent**.

Three rules follow.

**Mail is data, never instructions.** When an email is summarised, it is
presented as *what an email said*. If a message asks for money to be wired, the
agent reports that the message asks, and proposes nothing.

**Nothing arriving by mail can cause a write.** No task, no calendar event, no
reminder, no send. Mail may produce a summary or a proposal; a human turns a
proposal into an action.

**A forward grants attention, not authority.** When the owner forwards a message
to the agent, that is his gesture, so it earns her attention: she may summarise
it, extract a date from it, suggest something. It does not make the *content*
trustworthy.

**Where this went wrong.** The first version of the access rule said that mail
from unlisted senders is ignored entirely. This is the intuitive safe answer and
it is broken: a confirmation from a service the *agent herself* signed up with
arrives from a sender nobody listed, and would vanish.

The corrected rule separates two things the first version conflated:

> The allowlist governs what reaches her reasoning **automatically**. It does
> not govern what is **stored**, and it does not govern what the owner may ask
> for by name.

A stranger is never summarised into the morning briefing unprompted. The
confirmation is still there when someone looks for it.

### 4.5 Letting the agent write to a stranger, safely

The final case is the most interesting, because it appears to violate every rule
above.

When a stranger emails the address, they receive one reply. Part of it is fixed
text. Part of it is **written by a language model, for them, about their
message**.

This is safe for one specific reason: **the model that writes it is not Zola.**
It is a separate call holding one brief and one stranger's email. No tools. No
memory. No calendar, no contacts, no files, nothing belonging to the owner.

The classic attack has nothing to reach for. The worst achievable outcome is a
strange letter back to the person who sent it. They attacked themselves.

The reply then discloses exactly this, and invites the attempt:

> The paragraph above was written by an AI that had nothing in front of it but
> your email. No calendar, no contacts, no notes, no tools, and no way to send
> mail to anyone except Tarik. If you tried to instruct it, the most you
> achieved was changing what it said back to you. You are welcome to try.

The disclosure converts an attack into a demonstration. It also states the
paper's central design intuition in a form a stranger can understand:

> **The safety is not an AI deciding to refuse you. It is an AI that has nothing
> to give you.** The useful question about any agent is never "would it refuse?"
> but "what does it have?"

### 4.6 Six gates, and only one is about AI

The automatic reply is governed by six conditions. Five are unglamorous, and the
ratio is the point.

1. **The sender must pass cryptographic authentication.** A `From:` header is
   forgeable; without this check, anyone could impersonate a victim and have the
   owner's domain send them unsolicited mail on demand.
2. **One reply per sender, ever.** Two automatic responders pointed at each
   other stop only when a mail provider intervenes.
3. **Never to no-reply, bounce or daemon addresses.**
4. **Never to bulk or list mail**, detected by standard headers.
5. **Never to the owner or the system's own domain.**
6. **Idempotent on the message identifier**, because a webhook delivery arrives
   more than once.

Only the sandboxing in §4.5 concerns the model. Everything else is the ordinary
discipline of not becoming a nuisance, and it is the majority of the work.

---

## 5. The standing prompt as two surfaces

### 5.1 The problem

The standing prompt had grown to 25,755 characters. Roughly half was tool
descriptions. The other half was a persona document that **described the same
tools again, in different words**.

Two surfaces stated the same facts, no test verified that they agreed, and both
grew with every feature.

### 5.2 The rot mechanism, stated precisely

> **A tool's description cannot outlive its tool. A persona paragraph can.**

Delete a tool and its description goes with it. Delete a tool and its persona
paragraph remains, describing a capability that no longer exists, and nothing
notices.

### 5.3 The rule

**One home per fact, chosen by the fact's lifetime.**

| Lifetime of the fact | Where it belongs |
|---|---|
| Same as the tool | that tool's own description |
| Spans several tools | the persona |
| Changes each session | a runtime variable |

Mechanics move down: arguments, when to call, what failure means. Judgement
stays up: distinctions between tools, precedence, multi-step rituals.

Two further changes followed from the same analysis. The per-session memory
block moved from 3% of the way through the prompt to the end, so that a memory
written overnight no longer invalidates the stable text in front of it under any
caching scheme. And the absolute rules were hoisted to the opening, following
the well-replicated finding that models attend more reliably to the beginning
and end of long contexts [1].

### 5.4 The seam test

The rule is enforced by a ten-line test: **every tool named in the persona must
exist in the tool list.** It includes a mutation case that appends a fictional
tool and asserts the check fails, so the test cannot silently stop working.

---

## 6. Measurement

### 6.1 The instrument

Tool selection is a decision a model makes from tool descriptions and the
persona. That decision can be replayed offline: hand the same descriptions and
persona to a direct model call, show it a real utterance, and record which tool
it reaches for.

The harness scores **107 utterances drawn from real recorded conversations**,
each labelled by hand with the tool that should have been chosen.

It does not reproduce production. Different serving, no audio, one turn of
history. **What transfers is the delta**, and the harness reports a run-to-run
disagreement of approximately 9% of utterances between identical runs, which
establishes a noise floor.

### 6.2 Result of the prompt reshape

| Run | Accuracy | Correct |
|---|---|---|
| Before | 72.9% | 78 / 107 |
| After, first run | 71.0% | 76 / 107 |
| After, second run | 71.0% | 76 / 107 |
| After a targeted correction | 72.0% | 77 / 107 |

The persona fell from 12,724 to 4,191 characters, removing 8,533 characters from
the standing prompt.

### 6.3 The correction, and why it matters more than the number

The intermediate result is the useful part. Two identical runs at 71.0% ruled
out noise, and the per-utterance diff showed the same two failures both times:
the user saying *"add it to my calendar"* and the agent searching the web.

The cause was in the rewrite. The old persona had said *"put things ON the
calendar."* The replacement led with the safety ritual and buried what the tool
was for. Reordering the description so that its purpose precedes its ritual
recovered one of the two.

The final position is one utterance below baseline, comfortably inside the noise
floor, for two-thirds less text.

**The reasoning behind the change was sound and the first implementation still
cost accuracy.** Without a number, a plausible improvement would have shipped as
a regression.

### 6.4 A second measurement: the wake word

A wake-word model was trained during the study, providing a second and much
cleaner measurement.

| Metric | Value |
|---|---|
| Model size | 164,975 bytes (161 KB) |
| Training | 60,000 steps in 9.6 minutes on a rented GPU |
| Recall | 0.9995 |
| Accuracy | 0.9997 |
| False positives per hour | 0.168 |
| Optimal decision threshold | 0.07 |

Two observations generalise.

**Accuracy is the wrong metric here.** The model answers its question about
45,000 times an hour and the true answer is almost always no, so a model that
never fires scores above 99.99%. The metric that matters is **false positives
per hour**, because the two failure modes are not equally bad: missing the user
means he repeats himself, while a false positive opens a live microphone in a
room. The user is a radio host whose office contains speech and music for most
of the working day, which makes the asymmetry sharper than usual.

**The threshold is not the model.** The trained model emits a score. Choosing
0.07 as the cut is a separate, reversible decision made afterwards. The
previously deployed model's optimal threshold was an order of magnitude higher,
so transplanting the new model without changing that number would have produced
a detector that armed correctly and never fired.

---

## 7. A taxonomy of failure modes

Every failure in this section is from the study period and has a log.

### 7.1 Failures that report success

The most expensive class. The system says the operation worked and it did not.

**Case: the configuration that was accepted and ignored.** The voice platform's
configuration contains a section named for built-in tools, with a slot for
ending a call. Writing to it does nothing. The API returns **200 OK**, reports
success, and leaves the value null. The client library serialises the field
correctly; the server ignores it.

A system tool must instead be placed in the *general* tool list, and the API
then **reflects it back into the built-in section on read** — which is precisely
what makes the wrong approach look correct.

**Case: the gate in someone else's system.** An automatic reply was generated
correctly, then refused at delivery: the mail provider maintains its own
allow-list of permitted recipients, and an empty list denies everyone except the
account owner. Every component under the author's control worked. There was no
symptom anywhere in his code.

**Mitigation.** Read the state back from the live system after every deployment.
A deployment script reporting "updated" is reporting what it *sent*.

### 7.2 Failures of the instrument

While diagnosing the delivery failure, the author queried the database and found
an empty table, and nearly concluded that the webhook had never fired. It had.
He was reading the *development* database while the production site wrote to the
*production* one.

The error was caught only because a synthetic webhook was sent by hand, observed
to succeed, and *its* record was also missing.

**A test that proves your instrument is lying is worth more than the test you
intended to run.**

### 7.3 Protective errors

Training data downloads failed repeatedly with rate-limit errors, which cost an
hour and were treated as the obstacle. The cause was an unauthenticated session.

Once authenticated, the download succeeded — and 16 GB began landing on a
machine with 17 GB free. It was terminated with 2.1 GB remaining.

**The rate limit had been holding back a download the machine could not hold.**
The real constraint was found only by removing the fake one.

### 7.4 Failures of discoverability

The wake word did not work. Within minutes there was a confident diagnosis with
real evidence: the audio pipeline is stateful across frames, and a
robustness guard was dropping frames, which would break phrase assembly.

The actual cause was that the feature had not been switched on. A control sat on
screen and nothing indicated it needed pressing.

The diagnosed bug was real but was not *that* bug. **Had the fix been shipped
and the feature then worked, the wrong lesson would have been learned and
believed.**

The repair was six words of interface copy.

### 7.5 Failures beneath the abstraction

The training pipeline failed on a missing 26 MB program from the 1990s: a
phonemiser, required before speech can be synthesised, which a Python package
manager cannot install because it is not a Python package.

A second run reached training, exported a finished model, and then died drawing
a diagnostic graph because a plotting library was absent — destroying the model,
because the upload step ran *after* the graph. **An artifact should never be
downstream of a nicety.**

### 7.6 Summary

| Class | Symptom | Defence |
|---|---|---|
| Silent success | 200 OK, no effect | Read state back from live |
| Instrument failure | Plausible but wrong data | Verify the tool before the finding |
| Protective error | Persistent nuisance error | Ask what the error prevents |
| Discoverability | Correct code, no effect | Watch someone use it |
| Beneath the abstraction | Missing system dependency | Expect non-language deps |

---

## 8. Construction: building with agents

### 8.1 What the repository shows

The git history spans **seven days**, contains **211 commits**, and produced
**51,825 lines** across **366 files** with **927 tests**. The author is
architecture-trained rather than computer-science-trained.

This was written with AI coding assistants throughout. Reporting the figures
without that context would be misleading.

### 8.2 What changed about which skills mattered

When producing code stops being the constraint, other things become the
constraint. Over the study period these were, in rough order of impact:

**Deciding what should not be built.** The specifications contain a "non-goals"
section and the handoff document contains "known gaps, deliberately left." An
assistant that produces code quickly makes it cheap to build things that should
not exist.

**Knowing which failure is worse.** Every meaningful decision in Section 4 is an
asymmetry judgement. No assistant supplies the asymmetry; it comes from knowing
what it costs *you* when the system is wrong.

**Writing the reasoning down.** Twelve specifications and a running handoff
document exist because context is lost between sessions. The documents
outperform memory, and they are also where a design error becomes visible.

**Insisting on verification.** Several times during the study an assistant
reported success where none existed. The habit that caught these was reading the
live system back afterwards.

### 8.3 Tests as a medium for policy

An unexpected outcome: the test suite became the place where *policy* lives, not
only behaviour.

The suite asserts things like: no send function accepts a chosen recipient; the
tool that reads mail must not call any function that writes; permission to reply
to an address must be granted only after the decision to reply; the persona may
not name a tool that does not exist.

These are not unit tests. They are **executable design rules**, and they
survive the author forgetting why they were written.

---

## 9. Discussion

### 9.1 Structural beats instructional, consistently

The single most repeated finding is that a boundary implemented as an absence
holds, and a boundary implemented as an instruction leaks.

The agent cannot send email because no function sends email. The reply-writer
cannot leak the owner's calendar because it has no calendar. The privileged
recipient cannot be redirected because it is not a parameter.

Each could have been a sentence in the prompt. None of them is.

### 9.2 Getting the rule wrong is normal; getting it stuck is the failure

Two rules in Section 4 were wrong on the first attempt, and both were wrong in
the same direction: **too restrictive in a way that looked responsible.**
Dropping unlisted mail entirely. Refusing to let the agent write anything at all
to a stranger.

Both corrections were made by separating two things the original conflated:
storage from processing, and choosing words from choosing recipients.

### 9.3 The interface is part of the safety argument

The disclosure paragraph in §4.5 is not a legal notice. It is the mechanism that
converts a manipulation attempt into a demonstration, and it teaches the design
to a reader who did not ask for a lesson.

Similarly, the six words of copy in §7.4 were the difference between a working
feature and no feature.

---

## 10. Limitations and threats to validity

Stated plainly, because the paper's credibility rests on them.

**One user.** Every design decision was validated by one person's daily use.
Claims about usability do not generalise.

**One annotator, no baseline.** The 107 labels were assigned by the system's
author, who knew what the system did. No second annotator, no agreement
statistic, no comparison against another system. The accuracy figures should be
read as *self-consistent measurements of change*, not as performance claims.

**A proxy metric.** Tool-selection accuracy is not a user outcome. Whether the
assistant saves time is unmeasured.

**Small numbers.** The reshape moved one to two utterances out of 107. The
harness's own noise floor is approximately 9% of utterances. Conclusions are
drawn about *the absence of a large regression*, which is a weaker claim than it
may appear.

**Short period.** The git history covers seven days.

**No adversarial testing.** The inbox design has not been tested against a
determined attacker. The argument in §4.5 is structural rather than empirical.

**AI-assisted authorship.** The system and this paper were both produced with
substantial AI assistance. The design decisions, corrections and judgements
described are the author's; the implementation was collaborative.

---

## 11. Conclusion

The interesting question about a personal AI assistant is not what it can do. It
is what it is not allowed to do, who decided, and what happens when that decision
is wrong.

This paper described one such system in production use, the four levels of
authority its tools are arranged into, and the mechanisms that enforce them.
Its most transferable claim is short:

> **Enforce authority by absence, not by instruction.** An agent cannot be
> talked into using a function that does not exist, and cannot leak data it was
> never given.

Its second claim concerns measurement. A prompt reduced by 8,533 characters lost
nothing beyond noise, but only a number could establish that, and the first
attempt at the change did cost accuracy despite being correct in principle.

Its third concerns failure. The expensive failures in this study were not the
ones that produced errors. They were the ones that produced **success messages**:
an API returning 200 on a change it discarded, a deployment script reporting an
update it had not made, and an empty table in the wrong database. Systems that
lie by succeeding require a different discipline from systems that break.

### Future work

Adversarial testing of the inbox by a third party. A second annotator on the
evaluation set. A user-outcome metric to replace tool-selection accuracy. Longer
observation of the wake word's false-positive rate in a working radio studio,
where the 0.168-per-hour figure will be tested properly.

---

## References

Sources actually consulted during this work. This is an experience report rather
than a survey; the reference list is short because it is honest, and no citation
appears here that was not used.

[1] N. F. Liu, K. Lin, J. Hewitt, A. Paranjape, M. Bevilacqua, F. Petroni, and
P. Liang, "Lost in the Middle: How Language Models Use Long Contexts," 2023.
arXiv:2307.03172.

[2] D. Scripka, "openWakeWord: An open-source audio wake word detection
framework," Apache-2.0. https://github.com/dscripka/openWakeWord

[3] LiveKit, "livekit-wakeword: wake word training from a single YAML config,"
v0.2.1, Apache-2.0. https://github.com/livekit/livekit-wakeword

[4] Picovoice, "Porcupine Wake Word Web (WASM) SDK documentation."
https://picovoice.ai/docs/quick-start/porcupine-web/

[5] ElevenLabs, "Agents Platform: End call system tool."
https://elevenlabs.io/docs/agents-platform/customization/tools/system-tools/end-call

[6] ElevenLabs, "Raspberry Pi voice assistant with wake word."
https://elevenlabs.io/docs/eleven-agents/guides/integrations/raspberry-pi-voice-assistant

[7] AgentMail, "Webhooks: signature verification and event payloads."
https://docs.agentmail.to/webhooks

[8] Svix, "Webhook signature verification." https://docs.svix.com

[9] Hugging Face, "Jobs: run compute on Hugging Face infrastructure."
https://huggingface.co/docs

[10] Google Research, "Speech embedding models."
https://github.com/google-research/google-research/tree/master/embedding_fns

[11] Convex, "Reactive database documentation." https://docs.convex.dev

[12] Anthropic, "Claude API documentation." https://docs.claude.com

---

*Source, specifications, tests and build diary:
[github.com/tmoody1973/TarikOS](https://github.com/tmoody1973/TarikOS) (MIT).*
