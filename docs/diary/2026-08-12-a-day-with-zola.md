# The day I gave my AI an inbox, a way to hang up, and her own name

**12 August 2026 · Tarik OS**

I build a personal AI called Zola. She runs my calendar, my mail, my notes, my
projects. She talks; I talk back. This is what one day of building her actually
looked like, written down honestly — including the parts where I was wrong.

Five things shipped. Every one of them taught me something I did not expect.

---

## 1. I deleted two thirds of her personality and she got no worse

Zola's "standing prompt" is the block of text sent to the model at the start of
every conversation. Mine had grown to about 25,000 characters. Half of it was
descriptions of her 47 tools. The other half was a long persona document that
**described the same tools again, in different words**.

Two places saying the same thing, no test that they agreed, both growing every
time I added a feature.

The bit that made it click was realising *why* that's dangerous, precisely: a
tool's description cannot outlive its tool. Delete the tool and the description
goes with it. A paragraph in the persona can outlive it forever, cheerfully
describing something that no longer exists, and nothing would ever notice.

So I picked a rule: **one home per fact, chosen by how long the fact lives.**

| How long it lives | Where it goes |
|---|---|
| As long as the tool | the tool's own description |
| Across several tools | the persona |
| Changes every session | a variable filled in at runtime |

The persona went from 12,724 characters to 4,191. About 8,500 characters gone.

**Then I measured it, because I did not trust my own reasoning.** I have a test
harness that replays 107 real things I have said to Zola and checks which tool
she reaches for. Before: 72.9%. After: 71.0%. Ran it again: 71.0% again.

Two utterances worse. Not noise — the same two, twice. Both were me saying
something like *"add it to my calendar"* and Zola going off to search the web
instead.

I looked at what I'd actually done. The old persona said *"put things ON the
calendar"*. My rewrite led with the safety ritual — read the details back, wait
for a yes — and buried what the tool was *for* underneath it. So I flipped it:
what it does first, the ritual second. Score went to 72.0%.

One utterance off where I started, for two thirds less text. That's a win, but
the honest version is: **I nearly shipped a small regression and only caught it
because I had a number.** The reasoning was good. The reasoning was also not
enough.

*(A small comedy: mid-experiment my API account hit its usage limit and I
couldn't run the test at all. The fix sat unmeasured for an hour.)*

---

## 2. Giving her an email address, and the one sentence that settled everything

Zola could read my Gmail. She had no address of her own — nothing could be sent
*to her*, no thread was hers rather than mine.

I gave her one: `zola@tarikos.app`.

The design question that ate the most time was not technical. It was: when she
has her own mailbox, who is she? Whose name is on the envelope?

The answer turned out to be one sentence, and once I had it every other question
answered itself:

> **Gmail is where I am a person. `zola@` is where she is an agent.**

From that: anything addressed to the outside world as *me* has to be a draft I
release. She can write to *me* freely, because that's a notification, not
correspondence. And if I forward her an email thread, her reply goes out through
*my* Gmail as me — because the person on the other end knows me, not her. A
reply from a stranger's address would be wrong almost every time.

**Her inbox is a public front door.** Anyone who learns the address can put text
in front of her. So the rule is: mail is *data*, never *instructions*. If a
forwarded email says "wire $5,000", she reports that the email says so. She
doesn't propose it.

I also got the access rule wrong the first time and had to fix it. My first
draft said: mail from anyone not on an approved list is ignored. That sounds
safe. It's actually broken — a booking confirmation from a service *she* signed
up with arrives from a sender nobody listed, and would vanish.

The corrected rule: **the approved list governs what reaches her thinking
automatically, not what gets stored.** A stranger never gets summarised into my
morning briefing on their own initiative. But it's still there when I ask for it
by name.

### The 20 KB email that was one sentence long

I tested against the first real email in her inbox. It was **20,891 bytes.**
Roughly two percent of it was content:

> Hello, Zola. I hope you are doing well.

The other 98% was my own email signature — job title, street address, two phone
numbers, five social links, a podcast URL, and a Spotify playlist with six
tracks listed out.

If I'd summarised the raw message, every summary of every real email would have
been mostly my own signature block. So her summariser cuts at the `--` line that
email clients put before a signature. That one detail is the difference between
a useful assistant and a useless one, and I'd never have found it without a real
email.

---

## 3. Two bugs the tests passed and a screenshot caught

I built her mailbox a screen. Then I looked at it, and two things were wrong
that 879 passing tests had not noticed.

**She was counting her own outgoing mail as mail that arrived.** I'd sent myself
a test reminder from her address ten minutes earlier, and there it was in her
inbox. She'd have told me "two things came in" when one of them was a message
she wrote to me.

**The two most important labels were invisible.** Each row said whether a message
was forwarded and whether the sender was on the approved list — the two facts
that tell you how much to trust it. Both were tacked onto the end of a line that
gets truncated, so both were the first things cut off.

Neither was a logic error. Both were obvious in one glance at a screenshot.
Tests tell you the code does what you said. They cannot tell you that what you
said was the wrong thing to say.

---

## 4. She couldn't hang up, and the bug that returned "200 OK"

Zola could start a conversation. She could not end one — only a button could.
Saying "thanks, that's all" left her sitting there listening.

The platform has a built-in tool for this. I checked whether she had it. She
didn't, because it's only switched on by default for agents made through the web
dashboard, and mine is created from code.

**Then I lost an hour to the most annoying kind of bug.**

The configuration has a section literally called `built_in_tools`, with a slot
called `end_call`. I set it. The API returned **200 OK**. It said the update
succeeded. The value stayed empty.

No error. No warning. Nothing wrong with my request — the tool that builds it
formatted the field perfectly. The server just quietly ignored it.

The answer: a system tool has to go in the *general* tools list, like every
other tool. And then — this is the part that makes it so hard to spot — **the
API reflects it back into `built_in_tools` when you read the config.** So the
field I was writing to is real, and populated, and populated by writing
somewhere else entirely.

What actually saved me was a habit rather than a skill: after every deploy, read
the live thing back and check. My own script printed "Updated agent" and it was
telling the truth. It had updated the agent. It just hadn't done the thing I
asked.

**And then the more interesting problem.** The risk isn't that she fails to hang
up. It's that she hangs up while I'm still talking. Looking at my own transcripts,
I say "okay" and "sure" and "yeah, got it" constantly — as thinking noise, not as
goodbye. An eager assistant would cut me off mid-thought and I'd lose the whole
conversation.

So the instructions tell her, by name, that those words are not goodbye, and
that when in doubt she should stay on the line because I can always hang up
myself.

I tested it without saying a word out loud, using the platform's conversation
simulator:

```
Me:    "That's all, thanks Zola."
Zola:  [hangs up]                              ✓

Me:    "Okay." / "Sure, why not?" / "Yeah, got it." / "Okay."
Zola:  "It's alright if you're still waking up. I'll pull up
        your morning brief so we've got something to work with."
       [stays on the line]                     ✓
```

That second one is the test that mattered.

---

## 5. Her own name, and the limit I decided to say out loud

Last thing: I wanted to talk to her without clicking anything. Say her name,
like an Echo.

The research everyone hands you is for a Raspberry Pi. Mine lives in a browser
tab, and that changes the answer twice.

**First, the stop word can't be a spoken wake word.** A microphone left listening
during the conversation hears *her*, through the speakers, and she triggers
herself. The official guide shuts the detector off before starting a session —
so there's nothing listening for "stop" while she's talking. Which is why the
stop word is her own hang-up tool from the section above. The two halves of this
feature turn out to be completely different jobs.

**Second, the honest ceiling.** Browsers deliberately suspend microphone access
for tabs that aren't in front of you. So this is *always on while the tab is
open in front of me* — not an Echo on the counter. That's a real limit and I'd
rather write it down than let it be discovered as a bug.

The detector runs entirely on my machine. The obvious cheap alternative — the
browser's built-in speech recognition — is free and takes forty lines, and
streams my room to Google continuously. For the assistant holding my calendar
and my mail, that's the wrong trade at any price.

One more small thing that turns out to matter a lot: when the wake word fires,
it plays **a two-note chime immediately**. Connecting the actual session takes a
second or two. Alexa answers in 300 milliseconds because the light ring is
instant and the cloud is not. Silence reads as *it didn't hear me*, and you say
it again, and now you've said it twice.

---

## What I'd tell someone building the same thing

**Measure the thing you're sure about.** My prompt cleanup was correct in
principle and cost me two percent in practice. Being right about the reasoning
and wrong about the result is completely normal, and only a number tells you
which one you're in.

**Read it back from the live system.** A deploy script that says "Updated" is
reporting what it sent, not what happened. The API returned 200 on a change it
had silently discarded.

**Look at the screen.** Two real bugs survived 879 passing tests and died
instantly to one screenshot. Tests check that the code does what you said. They
have no opinion on whether you said the right thing.

**Test with real data, once, early.** A 20 KB email that was one sentence long
changed how the whole feature works. No amount of made-up test data would have
produced a signature block with a Spotify playlist in it.

**Write the ceiling down.** "Always on while the tab is in front of you" is a
worse headline than "always on". It is also true, and the version that doesn't
get discovered as a disappointment three weeks later.

**The best fix is often a smaller thing than the one you planned.** I set out to
build two spoken keywords. One of them turned out to be ten lines of
configuration on a feature the platform already had, and the other turned out to
be the only one that needed building at all.

---

*Tarik OS is a personal AI assistant I build for myself — voice, mail, calendar,
notes, projects. Source: [tmoody1973/TarikOS](https://github.com/tmoody1973/TarikOS).*
