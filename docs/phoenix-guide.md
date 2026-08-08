# Watching Zola work: a beginner's guide to Phoenix and Tarik OS

You built a voice assistant with 25 tools. When you ask her something, a language model decides which tool to reach for, the tool runs, and she says a sentence back. Most of that happens somewhere you can't see.

Phoenix is where you go to see it.

This guide assumes you've never used an observability tool before. It covers what Phoenix is, what's already wired up in Tarik OS, what to look at each day and each week, and how to use the parts of Phoenix that actually matter for this system. There's a lot of Phoenix you will never need. I'll say so when we get there.

---

## What Phoenix is, without the jargon

Phoenix is a place where records of your AI's work get written down, so you can go read them later.

That's it. Your app sends it records; Phoenix stores them, groups them, and draws them. It runs on your own Railway instance, so the data is yours and nobody else sees it.

Three words you'll see constantly:

**Span.** One thing that happened. "The `get_calendar` tool ran and took 2.6 seconds." "The model produced a response." A span has a name, a start and end time, and a bag of labelled details called attributes.

**Trace.** A group of related spans, arranged as a tree. One conversation with Zola is one trace: the conversation is the trunk, each turn is a branch, each tool call hangs off the turn that caused it.

**Project.** A named bucket of traces. Yours is `tarik-os`.

If you've used a browser's network tab, spans are the individual requests and a trace is everything one page load triggered. Same idea, applied to an AI instead of a webpage.

### One thing that trips everyone up

Phoenix labels every span with a **kind**: `AGENT`, `CHAIN`, `TOOL`, `LLM`, or `unknown`. The kind is just an attribute your app sets. Phoenix doesn't infer it.

This matters more than it sounds, because Phoenix's search box lets you filter on `span_kind`. If your app never sets the kind, every query you write returns nothing, and it looks like the search is broken rather than the data being untagged. You'll see `unknown` on the HTTP plumbing spans that Vercel adds automatically. That's fine — those aren't AI operations. Everything Tarik OS creates itself is tagged properly.

---

## What's wired up right now

Two separate paths feed Phoenix, and they see different things. Knowing which is which will save you a lot of confusion.

### Path one: the post-call webhook

When a voice conversation ends, ElevenLabs sends the whole transcript to `https://www.tarikos.app/api/elevenlabs/post-call`. That route checks the signature, maps the transcript into a tree, and ships it to Phoenix.

You get one `conversation` trace per call, shaped like this:

```
conversation                    (AGENT)  — the whole call
├── turn                        (CHAIN)  — you said something
├── turn                        (CHAIN)  — Zola said something
│   └── tool.get_calendar       (TOOL)   — and reached for a tool
└── turn                        (CHAIN)
```

The tool span sits under the turn that produced it. That pairing is the whole reason this path exists: it tells you what you said and which tool she picked, together, without you having to reconstruct it.

The route answers ElevenLabs as soon as the signature checks out, and ships to Phoenix afterwards. If Phoenix is down, ElevenLabs still gets its 200 and doesn't retry into a broken backend. Watching the system is never allowed to break the system.

### Path two: the tool route span

Every call to `/api/tools/<name>` is wrapped in a span, whether it came from a voice conversation or from a cron job at 7am. This one covers all 25 tools with a single wrapper, because they all pass through the same function.

This is the path that sees your **scheduled** work. The morning brief and the Sunday review call these routes over HTTP, so their tool calls show up here. The webhook path can't see them, because a cron has no conversation.

### What neither path sees

The habits evening check-in. It's a Convex function that writes directly to the database, so it never touches an HTTP route and never appears in Phoenix. Its evidence is the card that shows up on your dashboard.

---

## Reading a trace

Open Phoenix, pick the `tarik-os` project, and click **Traces**.

Each row is a conversation. Click one and the tree opens on the left, details on the right.

Things worth knowing as you poke around:

**Latency at the top is the whole conversation.** A 55-second trace means the call lasted 55 seconds, not that anything was slow.

**Tool spans have real durations now.** ElevenLabs reports how long each tool took, and the mapper reads it. If `get_calendar` shows 2.6 seconds, that's how long Google actually took to answer.

**`tool.is_error` means what it says.** For most of today it didn't — a bug meant it read `false` on every call whether the tool succeeded or blew up. That's fixed. If a tool call has no recorded result at all, you'll see `tool.no_result: true` instead of a comfortable green `false`.

**Turn spans show zero duration.** ElevenLabs reports when each turn started but not when it ended, so turns are drawn as instants. Not a bug, just missing data.

**Status "Unset" on the conversation** is cosmetic. Nothing calls `setStatus` on the root span. Ignore it.

---

## What to do every day

Five minutes, ideally after you've used Zola for a bit.

**1. Open the newest conversation trace.** Skim the turns. Does the tool she picked match what you asked for? You're not auditing, you're building a feel for it.

**2. Scan for red.** Phoenix marks errored spans. A red tool span means an actual failure. Cross-check it against `/control` — if the tool has a red health dot there too, the two systems agree and something is genuinely broken.

**3. Note anything that surprised you.** Not in a tracking system, just in your head or a scratch file. "She used `recall` when I wanted a web search." Those observations become the labels for your eval later, and they're much better than anything you'd invent from a blank page.

That's the whole daily practice. If you find yourself doing more than five minutes, you're either debugging something specific (fine) or procrastinating (also fine, but know which one it is).

---

## What to do every week

Half an hour, Sunday-ish, after the weekly review brief lands.

**1. Check the Metrics tab.** Trace volume and latency percentiles over the last seven days. You're looking for shape changes, not absolute numbers. A P90 that doubled means something got slower; find out what.

**2. Filter for failures.** In the span table, filter to error status. Group what you find. Three timeouts on the same tool is a pattern; one is weather.

**3. Look at your crons.** Filter to `tool.*` spans with no conversation parent — that's scheduled work. Did the morning brief run every weekday? Did the Sunday review fire? Silence here is the thing to notice, and it's the failure mode most likely to go unnoticed for weeks.

**4. Add five labels.** Open `evals/labels.csv`, find five rows you haven't reviewed, decide what tool *should* have been called, and set `reviewed` to `yes`. Five a week is nothing and it compounds. This is the step everyone skips and then wonders why their eval never gets built.

---

## Phoenix feature by feature

Phoenix has more surface area than you need. Here's each part, whether it's useful for Tarik OS, and what to do with it.

### Traces and Spans — use these constantly

Covered above. This is 90% of what you'll use Phoenix for.

The search box takes filter expressions. A few that earn their keep:

```
span_kind == 'TOOL'                     # every tool call
attributes['tool.name'] == 'get_habits' # one specific tool
attributes['tool.is_error'] == True     # failures only
attributes['tool.outcome'] == 'no_match' # she called a tool and got nothing
```

That last one is worth dwelling on. Several tools answer "no timed event matching that" with a success flag, because Zola should say a helpful sentence rather than report an error. The `tool.outcome` attribute records what actually happened underneath. A call that found nothing is `no_match`, not `success`, and a tool you've killed in `/control` reads `disabled` rather than looking like a crash.

That distinction is the difference between a measurement and a comfortable lie.

### Sessions — skip for now

Phoenix can group traces into multi-turn sessions. Tarik OS already models a conversation as a single trace, so this adds a layer you don't need. Revisit if you ever want to follow one topic across several separate calls.

### Metrics — weekly glance

Volume, latency, error rate over time. Useful for spotting drift. Not useful daily, because with one user the numbers are too noisy day to day to mean anything.

Cost will read $0. Phoenix computes cost from LLM token counts, and the conversation traces don't carry token attributes. Your drafting and consolidation spans do, so cost will populate for those when they fire. It'll never reflect your ElevenLabs bill.

### Annotations — this is the underrated one

An annotation is a note you attach to a span. A thumbs up or down, a score, a comment.

Here's why it matters more than it looks: **an annotation is a label, and a label is what an eval eats.** When you open a trace, see Zola pick the wrong tool, and annotate it "wrong tool, should have been web_research," you've just created a training example for free, at the exact moment you had the context to judge it. Doing that later from a CSV is harder and worse.

Phoenix can then build a dataset straight from annotated spans. Annotate as you browse, and the dataset assembles itself.

Start with one annotation type: `correct_tool`, thumbs up or down. Don't build a rubric. You'll invent categories you never use.

### Datasets — the input to everything measurable

A dataset is a saved collection of examples: an input, an expected output, some metadata. For Tarik OS the input is something you said and the expected output is the tool that should have run.

The dataset lives in Phoenix, not in git. This repo is public under MIT, and fifty real utterances are fifty pieces of your actual life — your calendar, your inbox, your goals, your habits. `evals/.gitignore` blocks every CSV for that reason. Only the code ships.

### Experiments — later, and worth the wait

An experiment runs a task over every example in a dataset, scores each result, and saves the run. Then you change something and run it again, and Phoenix shows you both.

That's the loop that turns "I think the new tool description is better" into "accuracy went from 67% to 74%." You need a labelled dataset first, which is why it comes after annotations.

### Prompts — skip

Phoenix can version and template prompts. Yours live in `scripts/provision-agent.ts` under git, which is a better system for a single-developer project. Don't split the source of truth in two.

---

## The eval loop, concretely

This is MOO-515 and MOO-516, and both are built. Here's how to actually run them.

### One-time setup

```bash
python3 -m venv evals/.venv
evals/.venv/bin/pip install anthropic
```

### Pull your real utterances

```bash
python3 evals/pull_utterances.py
cp evals/labels-draft.csv evals/labels.csv
```

This reaches into your ElevenLabs account, walks every past conversation, and writes out everything you said alongside the tool Zola reached for. Right now that's **108 utterances across 22 conversations**, 45 of which triggered a tool.

Which means the two-week wait everyone assumed was necessary isn't. The data was already sitting in your ElevenLabs account before the webhook existed.

### Label them

Open `evals/labels.csv`. Five columns matter:

| Column | What goes in it |
|---|---|
| `utterance` | What you said, verbatim. Don't edit it. |
| `actually_called` | What Zola did. Reference only. |
| `expected_tool` | What she **should** have done. This is the label. |
| `acceptable_alternatives` | Semicolon-separated, when two tools are both defensible |
| `reviewed` | `no` until you've actually read the row |

`expected_tool` comes pre-filled with what Zola did, which makes the file fast to review and useless if you don't. An unreviewed label scores her correct by definition. The harness warns you loudly about this every time it runs, and the warning is not decoration.

`acceptable_alternatives` isn't optional polish. Some things you say genuinely admit two right answers, and scoring them against a single label produces a low number that's wrong. A metric you don't trust in week one is a metric you stop looking at in week two.

### Run it

```bash
node evals/export_tools.ts                              # dump the 25 live tool definitions
evals/.venv/bin/python evals/replay.py --save baseline  # score and save
```

The harness sends each utterance to Claude with the same 25 tool descriptions and the same persona prompt the live agent uses, and watches which tool it reaches for.

This is not the ElevenLabs loop. Different serving, no audio, no conversation history, so the absolute number won't match production. What transfers is the *change* when you rewrite a description, and the change is the thing you act on. Use the Phoenix traces for the true baseline.

**Your first run scored 66.7%** on unreviewed labels — treat it as a smoke test, not a measurement.

### Read the confusion matrix

The accuracy number tells you how you're doing. The confusion matrix tells you what to fix.

Your baseline's top confusion:

```
web_research -> recall     3
```

The plan predicted exactly this before any data existed: *"recall and web_research bleed into each other, because 'what did I say about X' and 'what's happening with X' are close in intent space and both descriptions invite the model in."* Three real cases confirm it.

That's your first thing to fix.

### Change one sentence and measure

Open `scripts/provision-agent.ts`, find the `recall` tool's description, and tighten it — make it clear it searches *your own past conversations*, not the world. Then:

```bash
node evals/export_tools.ts
evals/.venv/bin/python evals/replay.py --compare baseline
```

You'll get the new accuracy, the delta, and a line for every single utterance that changed its answer. That per-utterance list is the important part. A flat overall number can hide two fixes and two regressions cancelling out.

Runs aren't perfectly repeatable — the model doesn't accept a temperature setting — so a point or two of wobble is noise. The list of changed utterances isn't.

When a change helps, ship it:

```bash
node scripts/provision-agent.ts
```

That's the loop. Rewrite a sentence, see the number move, deploy. Minutes instead of weeks.

---

## When something looks wrong

**Phoenix is empty after a call.** Check ElevenLabs' webhook delivery log first. A 200 there means the route is fine and the problem is the OTLP config downstream. Anything else means the delivery never landed.

**The webhook log shows 404.** The URL is wrong. It must be `https://www.tarikos.app/...` with the `www`. The bare domain 308-redirects, and a redirect on a signed POST loses the body the signature was computed over. The webhook's URL can't be edited after creation, so this means deleting and remaking it.

**The webhook log shows 401.** `ELEVENLABS_WEBHOOK_SECRET` doesn't match. Check both `.env.local` and Vercel.

**200 in the log, nothing in Phoenix.** `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_HEADERS` is wrong in Vercel. Local `.env.local` doesn't matter here — traces come from the deployed app.

**Everything says `unknown`.** Either you're looking at Vercel's automatic HTTP spans, which are supposed to be unknown, or a code path stopped setting `openinference.span.kind`.

**Traces land in a project called "default".** The `SEMRESATTRS_PROJECT_NAME` resource attribute isn't being set. `src/instrumentation.ts` has a comment about this specific failure, because service name alone isn't enough and the symptom looks like everything working.

**`replay.py` says no tools.json.** Run `node evals/export_tools.ts` first.

---

## The short version

Daily: open the newest trace, look for red, note anything surprising.

Weekly: check metrics for shape changes, look for failures with a pattern, confirm your crons ran, label five utterances.

Monthly or when something bugs you: run the harness, read the confusion matrix, rewrite one tool description, measure, deploy.

Skip Sessions and Prompts. Use Annotations more than you think you should — they're labels, and labels are the scarce thing.

And keep the honest habit that's already in this codebase: a green flag means nothing until you've watched it turn red. `tool.is_error` read `false` on every call for a day, and it looked completely fine.
