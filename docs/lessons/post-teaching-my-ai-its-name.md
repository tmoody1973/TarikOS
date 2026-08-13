I spent today teaching my AI assistant to recognize its own name. Here's what surprised me.

I build a personal AI called Zola. She reads my calendar, drafts my email, keeps my notes. Today I wanted her to answer when I say "Hey Zola," like an Echo, but private.

Five things I didn't expect:

**1. There are no recordings of anyone saying "Hey Zola."**

Because until this morning, nobody had ever needed to. So how do you teach a machine to recognize a sound that doesn't exist?

You make it up. The training generates thousands of synthetic voices saying the phrase, at different accents, pitches and speeds. Then it deliberately ruins them: adds room echo, traffic noise, music, distance.

That last part is the whole lesson. You're not teaching it what the phrase sounds like. You're teaching it what stays the same when everything else changes. Train on clean studio audio and it learns "quiet room, close to the mic," then fails the second you speak from the doorway with the radio on.

**2. Almost none of it is actually trained.**

I assumed "training a model" meant building something from scratch. It doesn't. The system is four pieces in a row, and only the last one learns anything. The first three, which turn sound into a picture and the picture into a numerical fingerprint, were trained by other people on far more data than I'll ever have. They're frozen. Untouched.

That's why the finished model is 161 KB, trained in ten minutes, instead of a gigabyte trained over a month. Take something general that someone else paid for, freeze it, train a small specific thing on top.

**3. The error I spent an hour fighting was protecting me.**

The training data wouldn't download. Hugging Face kept refusing with *429 Too Many Requests*, and I treated that as the problem to solve.

I wasn't logged in. Anonymous downloads get throttled hard. The fix was one command.

Then it worked, and 16 GB of training data started landing on a laptop with 17 GB free. I killed it at 2.1 GB remaining, which is close enough to "your Mac stops working" to be uncomfortable.

So the rate limit had been holding back a download I couldn't afford. I only found the real constraint by removing the fake one, and I'd been annoyed at the fake one for an hour.

**4. What finally broke it wasn't AI at all.**

After the login, after the disk, the pipeline died on this:

```
FileNotFoundError: espeak-ng not found
```

espeak-ng is a speech synthesizer that dates to the 1990s. Before a model can generate someone saying "Hey Zola," something has to turn those letters into phonemes, and that something is a 26 MB C program. Python's package manager can't install it, because it isn't a Python thing at all.

A GPU pipeline generating synthetic human speech, stopped by a missing dependency older than most of the people using it.

**5. Renting a GPU for an hour costs less than a coffee.**

I gave up on my laptop and moved the job to Hugging Face's hardware. An Nvidia L4, with 24 GB of GPU memory and 400 GB of storage, runs $0.80 an hour. The training should come in under a dollar.

No subscription needed either. I put $10 of credits on the account and ran a two-second test job first, to check it would work before committing to anything.

I've known for years that you can rent compute. Doing it, for a job my own machine could not hold, changed what "I can't run that locally" means to me. Usually it means I haven't spent a dollar yet.

---

Almost nothing that was hard today was the machine learning.

It was being logged in. Having disk space. A program from 1995. And knowing which kind of wrong I could live with: for a wake word, firing when I didn't speak is worse than missing me once, because one of those opens a live microphone in my office and the other means I say it again.

The model was the easy part, which I did not expect going in.

**The thing I'll actually remember**

Somewhere between the disk filling up and the job finally starting, it stopped being about the wake word.

I'd filed fine-tuning a language model under things other people do. Other people with GPUs, and budgets, and a background I don't have. Today I ran a two-second test job for a fraction of a cent, then a real training job on a rented GPU for under a dollar, and the entire barrier turned out to be a login and a credit card.

Gemma 4 is sitting on the same site I just used. So is nearly every dataset I'd want. The commands are the ones I typed this afternoon.

I set out to teach my assistant its own name. I came away knowing how to fine-tune a model, which is not something I could have said at breakfast. That's the part I'm still thinking about.
