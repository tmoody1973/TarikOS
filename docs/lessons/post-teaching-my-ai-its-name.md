I spent today teaching my AI assistant to recognize its own name. Here's what surprised me.

I build a personal AI called Zola. She reads my calendar, drafts my email, keeps my notes. Today I wanted her to answer when I say "Hey Zola" — like an Echo, but private.

Five things I didn't expect:

**1. There are no recordings of anyone saying "Hey Zola."**

Because until this morning, nobody had ever needed to. So how do you teach a machine to recognize a sound that doesn't exist?

You make it up. The training generates thousands of synthetic voices saying the phrase — different accents, pitches, speeds. Then it deliberately ruins them: adds room echo, traffic noise, music, distance.

That last part is the whole lesson. You're not teaching it what the phrase sounds like. You're teaching it what stays the same when everything else changes. Train on clean studio audio and it learns "quiet room, close to the mic" — then fails the second you speak from the doorway with the radio on.

**2. Almost none of it is actually trained.**

I assumed "training a model" meant building something from scratch. It doesn't. The system is four pieces in a row, and only the last one learns anything. The first three — turning sound into a picture, turning the picture into a numerical fingerprint — were trained by other people on far more data than I'll ever have. They're frozen. Untouched.

That's why the result is a 1.2 MB file trained in under an hour instead of a gigabyte trained over a month. Take something general that someone else paid for, freeze it, train a small specific thing on top.

**3. Being rate-limited was accidentally protecting me.**

The training data wouldn't download. Hugging Face kept refusing — *429 Too Many Requests* — and I spent a good while treating that as the obstacle.

Turns out I wasn't logged in. Anonymous downloads get throttled hard. The fix was one command.

Then it worked. And 16 GB of training data landed on a laptop that had 17 GB free. I killed it with 2.1 GB remaining, which is close enough to "your Mac stops working" to be uncomfortable.

The throttling I'd been cursing had quietly been protecting me from a download I couldn't afford. I only found the real constraint by removing the fake one.

That's happened to me before in other forms. The error you're fighting is sometimes the only thing standing between you and a worse error.

**4. The thing that finally broke it wasn't AI at all.**

After the login, after the disk, the pipeline died on this:

```
FileNotFoundError: espeak-ng not found
```

espeak-ng is a speech synthesizer that dates to the 1990s. Before a model can generate someone saying "Hey Zola," something has to turn those letters into phonemes — and that something is a 26 MB C program that Python's package manager can't install for you, because it isn't a Python thing at all.

Neural networks, GPUs, synthetic voice generation. Stopped dead by a missing system dependency older than most of the people using it.

**5. Renting a GPU for an hour costs less than a coffee.**

I gave up on my laptop and moved the whole job to Hugging Face's hardware. An Nvidia L4 — 24 GB of GPU memory, 400 GB of storage — runs **$0.80 an hour**. The training should come in under a dollar.

No subscription needed either. I put $10 of credits on the account and ran a two-second test job to confirm it worked before committing.

I've been vaguely aware you can rent compute for years. Actually doing it — for a job my own machine physically could not hold — changed what "I can't run that locally" means to me. Most of the time it just means "I haven't spent a dollar yet."

---

The part I keep coming back to: almost nothing that was hard today was the machine learning.

It was being logged in. Having disk space. A missing program from 1995. Knowing which kind of wrong I could live with — for a wake word, firing when I *didn't* speak is much worse than missing me once, because one of those opens a live microphone in my office and the other just means I say it again.

The model was the easy part. It always is now. The craft has moved somewhere else.
