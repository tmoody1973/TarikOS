# How a machine learns a name

**A plain-English lesson in machine learning, using the thing currently running
on my laptop as the worked example.**

I'm teaching my AI assistant to answer to "Hey Zola". Nobody has ever said that
phrase into a microphone, so there are no recordings of it. In about an hour
there will be a 1.2 MB file that recognises it in a noisy room.

This document explains what's actually happening in that hour. Almost every idea
in it applies to machine learning generally — I've flagged the ones that
transfer.

---

## 1. What we're actually building

It's tempting to think of a wake word as "an AI that listens." It isn't. It's
something much smaller and much dumber:

> **A thing that answers one yes/no question, twelve and a half times a second:
> "in the last second or two of sound, did somebody say the phrase?"**

That's it. It has no idea what words are. It can't transcribe anything. It
cannot tell you what you said. It scores one question, over and over, forever.

This is worth sitting with, because it's the shape of most useful machine
learning. Not "an intelligence." **One narrow question, asked relentlessly.**

The reason it has to be small and dumb is that it runs constantly. Something
listening all day, on a laptop, on battery, cannot be a large model. So the
whole design problem is: *how do you get a good answer to one question out of
something tiny?*

---

## 2. The assembly line

The answer is that it isn't one model. It's four things in a row, and only the
last one is ours.

```
  microphone
      │
      ▼
  ① mel spectrogram      "turn sound into a picture"
      │
      ▼
  ② speech embedding     "turn the picture into a fingerprint"
      │
      ▼
  ③ a 16 × 96 grid       "the last ~1.5 seconds, as numbers"
      │
      ▼
  ④ the classifier       "…is that the phrase? 0.83"
```

**① Sound becomes a picture.** A microphone gives you a wiggly line — air
pressure over time. That's a terrible thing to pattern-match against. So the
first step converts it into a *spectrogram*: a picture where one axis is time,
the other is pitch, and brightness is loudness. Speech has very distinctive
shapes in that picture.

If you're architecturally minded: you've stopped looking at the elevation and
started looking at the section. Same building, but now you can see the structure.

**② The picture becomes a fingerprint.** The second model — trained by Google on
an enormous amount of speech — takes a slice of that picture and produces **96
numbers**. Those numbers don't mean anything individually. Together they're a
compact description of *what kind of speech sound this is*: something like "a
short vowel with this quality after a soft consonant."

**③ The grid.** Every 80 milliseconds you get a new set of 96 numbers. Keep the
last 16 sets and you have a **16 × 96 grid** — a description of roughly the last
second and a half of sound, as 1,536 numbers.

**④ The classifier.** Ours. It looks at the grid and outputs one number between
0 and 1. That's the only part being trained today.

---

## 3. The load-bearing idea: freeze most of it

Steps ① and ② are **frozen**. They were trained by other people, on far more
data than I have, and **training does not change them at all.** They are fixed
machinery that runs the same way forever.

Only step ④ learns anything.

This is called **transfer learning**, and it is the single most useful concept
in this document. The intuition:

> Recognising *that a human voice made a sound, and roughly what sound* is a
> general problem. Somebody already solved it, expensively. Recognising *that
> the sound was specifically "hey zola"* is a tiny, specific problem sitting on
> top of a solved general one.

Everything follows from that:

| Because the front end is frozen… | …you get |
|---|---|
| the trained part is tiny | **a 1.2 MB file**, not a gigabyte |
| there's little to learn | **an hour**, not a month |
| it runs anywhere | in a **browser tab**, on battery |
| you need few examples | thousands, not millions |

**This transfers to nearly all applied AI.** Almost nobody trains from scratch.
You take something large and general that someone else paid for, freeze it, and
train a small specific thing on top. Fine-tuning a language model is the same
move. So is most computer vision.

### The elegant consequence

Here's a detail I loved. Training needs lots of **negative** examples —
recordings that are *not* the phrase — so the model learns what to reject.

The download for that is **4.1 GB**, and it isn't audio. It's the *fingerprints*
of a huge pile of general audio: thousands of hours already run through steps ①
and ②.

They can ship the fingerprints instead of the sound **because the front end is
frozen.** It will produce identical output forever, so you compute it once and
never again. That one design decision is why a 4.1 GB download replaces what
would otherwise be a terabyte of audio and days of processing.

**Transfers:** when part of your pipeline is deterministic and never changes,
its output is cacheable forever. That's as true of a build system as of a neural
network.

---

## 4. Where do the examples come from if nobody has said it?

Here's the bit that sounds like cheating.

To train a classifier you need examples of yes and examples of no. Nobody has
ever said "Hey Zola," so there are no yes-examples.

**So it makes them up.** It uses a text-to-speech model to generate thousands of
synthetic voices saying the phrase — different accents, pitches, speeds,
genders, cadences.

Then, crucially, it **ruins them on purpose**. This is called *augmentation*:

- add room echo, using recordings of real rooms — a kitchen, a hall, a car
- mix in background noise: traffic, a television, a café, music
- make it quieter, as if spoken from across the room
- shift the pitch and speed slightly
- clip it, compress it, distort it

**Why deliberately damage your training data?** Because you're not teaching the
model what the phrase *sounds like*. You're teaching it what stays the same
about the phrase **when everything else changes**.

That's the actual definition of learning here:

> **Learning is finding what stays constant across variation.**

If every example were clean studio audio, the model would learn "hey zola *in a
quiet room, close to the mic*" — and fail the moment you said it from the
doorway with the radio on. The variation isn't noise in the data. **The
variation is the lesson.**

**Transfers:** this is why "we only have clean data" is a problem and not a
luxury, in every ML project. A model trained on tidy inputs learns the tidiness.

---

## 5. The negatives matter more than the positives

Most people assume the hard part is teaching it to recognise the phrase. It
isn't. The hard part is teaching it to **not** fire the rest of the time.

Think about the arithmetic. It asks its question 12.5 times a second — about
**45,000 times an hour**. I might say the wake word ten times a day. So the true
answer is "no" something like 99.998% of the time.

Which means: *a model that simply always says no is 99.998% accurate.*

That's why the training generates **adversarial negatives** — not just random
sound, but phrases deliberately chosen to sit close to the boundary. Things like
"hey zora", "hey sofa", "say zola", "hey, so la…". Near misses.

> You don't learn a boundary from things that are obviously on one side. You
> learn it from the things that *nearly* belong.

**Transfers, and it's one of the most useful ideas in applied ML:** the value of
a training example is roughly how close it is to the decision boundary. Ten
thousand obvious examples teach less than a hundred hard ones. This is why
labelling the confusing cases is worth more than labelling more cases.

---

## 6. What "training" is actually doing for an hour

Demystified, the loop is embarrassingly simple, repeated **50,000 times**:

1. Take a batch of examples — some phrase, some not.
2. Run them through the classifier. Get scores.
3. Compare to the right answers. Measure how wrong it was. *(That number is
   called the loss.)*
4. Work out, for every one of the classifier's internal numbers, whether nudging
   it up or down would have made the answer slightly less wrong.
5. Nudge them all, slightly, in that direction.
6. Repeat.

That's it. There's no reasoning, no understanding, no representation of "names."
It's **fifty thousand tiny corrections**, each one making the average answer a
little less wrong than before.

The only genuinely clever part is step 4 — computing that "which way should each
number move" efficiently, for millions of numbers at once. It's calculus, it was
worked out decades ago, and you never have to think about it.

Two things that fall out of this, both worth knowing:

**It can memorise instead of learning.** If you show it the same examples too
many times, it stops finding the pattern and starts memorising the answers —
perfect on training data, useless on your voice. That's *overfitting*, and it's
why you always hold back examples the model never trains on, to check.

**More steps is not automatically better.** Training longer eventually makes it
worse. The interesting question is never "how long did you train?" but "how did
it do on data it has never seen?"

---

## 7. The choice I actually made, and why

The tool offered a few classifier shapes. Two are worth contrasting, because the
difference is a genuinely good lesson about model design.

**Option A — flatten it.** Take the 16 × 96 grid, mash it into one long line of
1,536 numbers, feed that to a standard network.

This works, and it throws something away: **the order.** Once flattened, the
model can't easily tell "this sound, *then* that sound" from "that sound, *then*
this sound." A phrase is a sequence. Flattening deletes the sequence and hopes
the model re-derives it.

**Option B — keep the shape.** Slide a small window along the time axis looking
for local patterns (*convolution*), then let each moment weigh how much every
other moment matters (*attention*).

I chose B. In architectural terms: option A takes a floor plan and hands you an
alphabetical list of rooms. Option B keeps the plan. Both contain the same
rooms; only one tells you what's next to what.

> **The general principle: if your data has a structure — time, space, order,
> hierarchy — a model that preserves that structure will beat one that destroys
> it and hopes.** Convolution preserves locality. Attention preserves
> relationships. Flattening preserves nothing.

It costs more to train. I took it for one specific reason, below.

---

## 8. The metric that matters isn't accuracy

My training config says:

```yaml
target_fp_per_hour: 0.2
```

**False positives per hour.** Not accuracy. As we established, accuracy here is
a meaningless number — a broken model scores 99.998%.

0.2 per hour means: *wake up wrongly about once every five hours.*

That's the number I actually care about, because of an asymmetry:

- **Missing me once** — I say it again. Mildly annoying.
- **Firing when I didn't speak** — a live microphone opens in a room, a session
  starts, and I didn't ask for it.

Those two failures are not equally bad. **They are never equally bad**, in any
system worth building, and the whole job of choosing a metric is naming which
one you'd rather have.

I'm a radio host. My office has voices and music in it most of the day, which is
a nearly adversarial environment for a wake word — hours of human speech that
must all be rejected. That asymmetry is why I paid extra for the fussier
classifier in §7.

**Transfers, and it's the one I'd tattoo on something:** *the metric is a
product decision, not a technical one.* "Accuracy" almost always hides the
question that matters, which is **which kind of wrong can you live with?**

---

## 9. The threshold is not the model

One last idea, small and very practical.

The trained model doesn't output "yes." It outputs a **score** — 0.83, 0.12,
0.51. Deciding that 0.7 and above counts as a wake is a **separate choice, made
afterwards, changeable in one line, without retraining anything.**

I set it to 0.7 rather than the usual 0.5 because of the room. If it turns out
twitchy, I move it to 0.8 tonight and nothing is retrained.

> **The model gives you a number. Turning that number into a decision is a
> product choice, and it is reversible.**

An enormous amount of practical ML is choosing thresholds well, and it's easy to
miss because it happens after the interesting part. This is also why I made the
score print to the console: *"nothing fires"* is unfixable, but *"it scored 0.62
and the threshold is 0.7"* is a five-second fix.

---

## The short version

If you remember five things:

1. **Freeze what's general, train what's specific.** It's why this is 1.2 MB and
   an hour instead of a gigabyte and a month.
2. **Learning is finding what stays constant across variation** — which is why
   you deliberately damage your training data.
3. **The negatives near the boundary teach more than the positives.**
4. **Accuracy usually hides the real question**, which is which kind of wrong
   you can live with.
5. **The model outputs a number; the decision is yours**, later, and reversible.

And the one that isn't about machine learning at all: none of the hard parts
today were the model. They were knowing what question to ask, knowing which
mistake was worse, and being able to see what was happening.

---

*Written while the training ran. Part of the [Tarik OS](https://github.com/tmoody1973/TarikOS)
build diary.*
