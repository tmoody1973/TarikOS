"""Score tool selection against your labeled utterances, in seconds.

    python evals/replay.py                    # score, print accuracy + confusion matrix
    python evals/replay.py --save before      # save the run so you can diff against it
    python evals/replay.py --compare before   # score again and show what moved

    python evals/replay.py --upload-dataset   # push labels.csv to Phoenix, once
    python evals/replay.py --phoenix baseline # score the Phoenix dataset, keep the run

Two loops on purpose. --save/--compare is the inner loop: offline, instant, and it
prints every utterance that changed answer. --phoenix is for runs worth keeping —
it scores the rows Phoenix hands back so every run attaches to a real dataset
example, and two experiments become comparable inside the Phoenix UI.

You cannot replay a voice conversation. You don't need to. Picking a tool is a
decision a language model makes from the tool descriptions and the persona
prompt — so hand the same 25 descriptions and the same persona to a direct
Claude call, show it one of your real utterances, and watch which tool it
reaches for. Change a description, run this again, see the number move.

This is not the ElevenLabs agent loop. Different serving, no audio, and only
one prior exchange of history rather than the whole conversation. Absolute
numbers will not match production. What transfers is the *delta* when you
rewrite a description, and the delta is the thing you iterate on. Use Phoenix
traces for the true baseline.
"""

import argparse
import collections
import csv
import datetime as dt
import functools
import json
import math
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

import anthropic

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVALS = ROOT / "evals"
MODEL = "claude-sonnet-5"  # the model the live agent runs on
DATASET = "tool-selection-v1"
PHOENIX_TIMEOUT = 30

# Thinking and response share this budget. On claude-sonnet-5 an omitted
# `thinking` field runs ADAPTIVE thinking — a silent default change from
# Sonnet 4.6, where omitting it meant no thinking at all. This harness ran at
# 512 for exactly that reason: it was written against the old default. Thinking
# then consumed the budget and turns came back truncated and empty, which the
# scorer read as "chose no tool" — inventing misses on rows whose right answer
# was a tool call.
MAX_TOKENS = 4096
TRUNCATED = "__truncated__"


@functools.lru_cache(maxsize=None)
def env(name: str) -> str:
    for line in (ROOT / ".env.local").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is missing from .env.local")
    return value


def load_tools() -> tuple[str, list[dict]]:
    path = EVALS / "tools.json"
    if not path.exists():
        raise SystemExit("Run `node evals/export_tools.ts` first — no tools.json yet.")
    blob = json.loads(path.read_text())
    tools = [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": {
                "type": "object",
                "properties": {
                    k: {"type": "string", "description": v.get("description", "")}
                    for k, v in (t.get("properties") or {}).items()
                },
                "required": t.get("required") or [],
            },
        }
        for t in blob["tools"]
    ]
    return blob["persona"], tools


def load_labels() -> list[dict]:
    path = EVALS / "labels.csv"
    if not path.exists():
        raise SystemExit(
            "No evals/labels.csv. Run `python evals/pull_utterances.py`, fill in the\n"
            "expected_tool column on the rows worth scoring, and save it as labels.csv."
        )
    rows = [r for r in csv.DictReader(path.open()) if (r.get("expected_tool") or "").strip()]
    if not rows:
        raise SystemExit("labels.csv has no rows with expected_tool filled in.")

    # An unreviewed label is just a copy of what she already did, so scoring it
    # measures nothing and returns a reassuring number. Say so out loud.
    unreviewed = sum(1 for r in rows if (r.get("reviewed") or "").strip().lower() != "yes")
    if unreviewed:
        print(
            f"\n  WARNING: {unreviewed} of {len(rows)} rows are not reviewed yet.\n"
            "  Those labels were copied from what Zola actually did, so she scores\n"
            "  correct on them by construction. Read them, fix the wrong ones, and\n"
            "  set reviewed=yes. Until then this number is decoration.\n"
        )
    return rows


def matches(row: dict, predicted: str) -> bool:
    """The one place the pass/fail rule lives — local scoring and Phoenix agree."""
    alternatives = {
        a.strip()
        for a in (row.get("acceptable_alternatives") or "").split(";")
        if a.strip()
    }
    return predicted == row["expected_tool"].strip() or predicted in alternatives


# ---------------------------------------------------------------- Phoenix
# Every shape below was validated against one real call before it was written.
# The REST root is derived from the OTel endpoint already in .env.local, so
# there is no second place to configure when Phoenix moves.


def phoenix_base() -> str:
    return env("OTEL_EXPORTER_OTLP_ENDPOINT").split("/v1/")[0].rstrip("/")


def phoenix(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{phoenix_base()}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {env('PHOENIX_API_KEY')}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=PHOENIX_TIMEOUT) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:400]
        raise SystemExit(f"Phoenix {method} {path} -> {error.code}: {detail}")
    return json.loads(payload) if payload else {}


def upload_dataset(name: str, rows: list[dict]) -> str:
    """Push labels.csv to Phoenix. `reviewed` rides along so the artifact self-labels."""
    result = phoenix(
        "POST",
        "/v1/datasets/upload?sync=true",
        {
            "action": "create",
            "name": name,
            "description": (
                "Tool selection ground truth from real ElevenLabs conversations. "
                "Check the `reviewed` metadata before trusting a score."
            ),
            "inputs": [
                {
                    "utterance": r["utterance"],
                    "prev_user": (r.get("prev_user") or "").strip(),
                    "prev_agent": (r.get("prev_agent") or "").strip(),
                }
                for r in rows
            ],
            "outputs": [
                {
                    "expected_tool": r["expected_tool"].strip(),
                    "acceptable_alternatives": (r.get("acceptable_alternatives") or "").strip(),
                }
                for r in rows
            ],
            "metadata": [
                {
                    "reviewed": (r.get("reviewed") or "no").strip().lower(),
                    "actually_called": (r.get("actually_called") or "").strip(),
                    "conversation_id": (r.get("conversation_id") or "").strip(),
                }
                for r in rows
            ],
        },
    )["data"]
    return result["dataset_id"]


def find_dataset(name: str) -> str:
    query = urllib.parse.urlencode({"name": name})
    for dataset in phoenix("GET", f"/v1/datasets?{query}")["data"]:
        if dataset["name"] == name:
            return dataset["id"]
    raise SystemExit(f"No Phoenix dataset called {name}. Run --upload-dataset first.")


def example_to_row(example: dict) -> dict:
    """A Phoenix example in the same shape score() already expects from the CSV."""
    output = example.get("output") or {}
    given = example.get("input") or {}
    return {
        "example_id": example["id"],
        "utterance": given.get("utterance", ""),
        "prev_user": given.get("prev_user", ""),
        "prev_agent": given.get("prev_agent", ""),
        "expected_tool": output.get("expected_tool", ""),
        "acceptable_alternatives": output.get("acceptable_alternatives", ""),
        "reviewed": (example.get("metadata") or {}).get("reviewed", "no"),
    }


def load_phoenix_examples(dataset_id: str) -> tuple[list[dict], str]:
    """Score the rows Phoenix hands back, not the CSV — that is what pins every
    run to a real dataset_example_id and a specific dataset version."""
    data = phoenix("GET", f"/v1/datasets/{dataset_id}/examples")["data"]
    return [example_to_row(e) for e in data["examples"]], data["version_id"]


def evaluation_payload(run_id: str, row: dict, predicted: str, at: str) -> dict:
    ok = matches(row, predicted)
    return {
        "experiment_run_id": run_id,
        "name": "tool_match",
        "annotator_kind": "CODE",
        "start_time": at,
        "end_time": at,
        "result": {
            "label": "correct" if ok else "incorrect",
            "score": 1.0 if ok else 0.0,
            "explanation": f"expected {row['expected_tool'].strip()}, got {predicted}",
        },
    }


def push_experiment(
    name: str,
    dataset_id: str,
    version_id: str,
    rows: list[dict],
    predictions: list[str],
    timings: list[tuple[str, str]],
    result: dict,
    tool_count: int,
) -> None:
    unreviewed = sum(1 for r in rows if (r.get("reviewed") or "").strip().lower() != "yes")
    experiment = phoenix(
        "POST",
        f"/v1/datasets/{dataset_id}/experiments",
        {
            "name": name,
            "description": f"replay.py tool selection on {MODEL}",
            "version_id": version_id,
            "repetitions": 1,
            "metadata": {
                "model": MODEL,
                "tool_count": tool_count,
                "accuracy": round(result["accuracy"], 4),
                "unreviewed_labels": unreviewed,
                "harness": "evals/replay.py",
            },
        },
    )["data"]

    for i, (row, predicted, (started, ended)) in enumerate(zip(rows, predictions, timings), 1):
        run_id = phoenix(
            "POST",
            f"/v1/experiments/{experiment['id']}/runs",
            {
                "dataset_example_id": row["example_id"],
                "output": {"predicted_tool": predicted},
                "repetition_number": 1,
                "start_time": started,
                "end_time": ended,
            },
        )["data"]["id"]
        phoenix(
            "POST",
            "/v1/experiment_evaluations",
            evaluation_payload(run_id, row, predicted, ended),
        )
        print(f"\r  pushing {i}/{len(rows)}", end="", flush=True)

    print(f"\n\nexperiment {name} -> {phoenix_base()}/datasets/{dataset_id}/experiments")
    if unreviewed:
        print(f"  tagged unreviewed_labels={unreviewed} in the experiment metadata")


def conversation(row: dict) -> list[dict]:
    """The turns to send: the previous exchange, then what you said.

    "Sounds good." and "Yes, please." are unanswerable alone — the replay says
    `none` every time and it reads as a tool-description problem when it is
    really a missing referent. Only include the prior exchange when BOTH halves
    are present: the Messages API wants strict user/assistant alternation
    starting with user, and half a turn is worse context than none.
    """
    previous, answer = (row.get("prev_user") or "").strip(), (row.get("prev_agent") or "").strip()
    turns = []
    if previous and answer:
        turns.append({"role": "user", "content": previous})
        turns.append({"role": "assistant", "content": answer})
    turns.append({"role": "user", "content": row["utterance"]})
    return turns


def predict(client, persona: str, tools: list[dict], row: dict) -> str:
    """Return the tool the model reaches for, or 'none' if it just answers.

    There is deliberately no temperature here: it is REMOVED on claude-sonnet-5
    and any non-default value returns 400 (verified 2026-08-09 —
    "`temperature` is deprecated for this model"). So this harness cannot be
    made deterministic, and a single run cannot attribute a delta to an edit.
    Measured the same day: two runs of identical code scored 70.1% and 72.9% —
    a 2.8-point swing from nothing at all, wider than the effect of the
    description rewrite it was meant to measure.

    --repeat is the answer to that. Run the suite N times, compare a change
    against the NOISE BAND rather than against one number, and only believe a
    delta that clears it. The band comes from how many rows flip, not from the
    range of the aggregate — see instability().
    """
    message = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=persona,
        tools=tools,
        messages=conversation(row),
    )
    for block in message.content:
        if block.type == "tool_use":
            return block.name
    # A truncated turn is NOT a decision to do nothing. Scoring it as "none"
    # is how this harness manufactured misses: at max_tokens=512 the request
    # came back with stop_reason=max_tokens and empty content, and every one
    # was counted as Zola declining to act. Say so instead of guessing.
    if message.stop_reason == "max_tokens":
        return TRUNCATED
    return "none"


def score(rows: list[dict], predictions: list[str]) -> dict:
    correct = 0
    confusion: dict[tuple[str, str], int] = collections.Counter()
    misses = []

    for row, got in zip(rows, predictions):
        expected = row["expected_tool"].strip()
        ok = matches(row, got)
        correct += ok
        confusion[(expected, got)] += 1
        if not ok:
            misses.append({"utterance": row["utterance"], "expected": expected, "got": got})

    return {
        "n": len(rows),
        "correct": correct,
        "accuracy": correct / len(rows) if rows else 0.0,
        "confusion": {f"{e}->{g}": c for (e, g), c in confusion.items()},
        "misses": misses,
        "predictions": predictions,
    }


def report(result: dict) -> None:
    print(f"\naccuracy  {result['accuracy']:.1%}  ({result['correct']}/{result['n']})\n")

    truncated = sum(1 for p in result["predictions"] if p == TRUNCATED)
    if truncated:
        print(
            f"  WARNING: {truncated} turns hit max_tokens and produced no tool call.\n"
            f"  Those are truncations, not decisions — raise MAX_TOKENS (currently\n"
            f"  {MAX_TOKENS}); thinking shares this budget. They are scored as wrong,\n"
            "  but the model never got to answer.\n"
        )

    # Per-tool recall: of the times this tool was the right answer, how often
    # was it picked. This is where an over-broad description shows up.
    by_expected: dict[str, list[bool]] = collections.defaultdict(list)
    for key, count in result["confusion"].items():
        expected, got = key.split("->")
        by_expected[expected].extend([expected == got] * count)

    print("per tool (right answer -> how often picked)")
    for tool in sorted(by_expected, key=lambda t: sum(by_expected[t]) / len(by_expected[t])):
        hits = by_expected[tool]
        print(f"  {tool:<24} {sum(hits)}/{len(hits)}")

    wrong = {k: v for k, v in result["confusion"].items() if k.split("->")[0] != k.split("->")[1]}
    if wrong:
        print("\nconfusions (expected -> picked)")
        for key, count in sorted(wrong.items(), key=lambda kv: -kv[1]):
            print(f"  {key:<48} {count}")

    if result["misses"]:
        print("\nmisses")
        for m in result["misses"][:15]:
            print(f'  "{m["utterance"][:60]}"')
            print(f"      wanted {m['expected']}, got {m['got']}")


def instability(rows: list[dict], runs: list[dict]) -> dict:
    """How much of this harness's output is noise, measured per row.

    The aggregate range across a handful of runs is the wrong number to lead
    with. On 2026-08-09 three runs of identical code each scored exactly 71.0%
    while 14 of 107 utterances answered differently between them: the flips
    cancelled out, the range printed 0.0%, and a bar of zero says every move is
    real. A fourth scoring of the same code landed at 70.1%, so even the
    observed range was never actually zero — three runs were just too few to
    see it.

    The flips are the signal, and they are the thing that does not cancel. Each
    unstable row behaves like a coin toss, so it contributes Bernoulli variance
    0.25 to the correct-count; u independent flips give the accuracy a standard
    deviation of sqrt(u * 0.25) / n, and a ~95% band of twice that — sqrt(u)/n.
    For 14 of 107 that is +/-3.5%, which is a bar a change can be measured
    against. Stable rows contribute nothing, so a set that truly does not move
    still reports zero.
    """
    flipped = [
        (row, seen)
        for i, row in enumerate(rows)
        if len(seen := {r["predictions"][i] for r in runs}) > 1
    ]
    accuracies = [r["accuracy"] for r in runs]
    return {
        "n": len(rows),
        "flipped": flipped,
        "unstable": len(flipped),
        "band": math.sqrt(len(flipped)) / len(rows) if rows else 0.0,
        "best": max(accuracies),
        "worst": min(accuracies),
        "range": max(accuracies) - min(accuracies),
    }


def spread(rows: list[dict], runs: list[dict]) -> None:
    """Print the instability, flips first and the aggregate range demoted."""
    s = instability(rows, runs)
    print(f"\nacross {len(runs)} runs of identical code")
    print(f"  {s['unstable']}/{s['n']} utterances answered differently between runs")
    print(f"  noise band  +/-{s['band']:.1%}  <- a change must beat this to mean anything")
    print(f"\n  observed range {s['range']:.1%}  (best {s['best']:.1%}, worst {s['worst']:.1%})")
    print(
        f"  Secondary, and do not use it as the bar: {len(runs)} runs cannot pin the\n"
        "  range, and flips that cancel out hold it near zero while the set moves."
    )

    if s["flipped"]:
        print()
    for row, seen in s["flipped"][:10]:
        print(f'  "{" ".join(row["utterance"].split())[:52]}"  {" / ".join(sorted(seen))}')
    if s["unstable"] > 10:
        print(f"  … and {s['unstable'] - 10} more")


def selftest() -> None:
    """Offline check of the pure logic. Runs in a second, needs no network."""
    row = {"expected_tool": "recall", "acceptable_alternatives": "web_research; browse"}
    assert matches(row, "recall")
    assert matches(row, "web_research")
    assert matches(row, "browse")
    assert not matches(row, "get_emails")
    assert not matches({"expected_tool": "none", "acceptable_alternatives": ""}, "recall")

    converted = example_to_row(
        {
            "id": "ex1",
            "input": {"utterance": "what did I say about the grant"},
            "output": {"expected_tool": "recall", "acceptable_alternatives": "web_research"},
            "metadata": {"reviewed": "no", "conversation_id": "conv_a"},
        }
    )
    assert converted["example_id"] == "ex1"
    assert converted["utterance"] == "what did I say about the grant"
    assert matches(converted, "web_research")
    assert example_to_row({"id": "ex2"})["expected_tool"] == ""

    # `reviewed` must come from Phoenix, never be assumed. This is the honest-
    # metadata guarantee: an unreviewed row has to keep saying so.
    assert converted["reviewed"] == "no"
    assert example_to_row({"id": "ex3", "metadata": {"reviewed": "yes"}})["reviewed"] == "yes"
    assert example_to_row({"id": "ex4"})["reviewed"] == "no"

    hit = evaluation_payload("run1", converted, "recall", "2026-01-01T00:00:00+00:00")
    assert hit["result"] == {
        "label": "correct",
        "score": 1.0,
        "explanation": "expected recall, got recall",
    }
    miss = evaluation_payload("run1", converted, "get_emails", "2026-01-01T00:00:00+00:00")
    assert miss["result"]["label"] == "incorrect"
    assert miss["result"]["score"] == 0.0
    assert miss["experiment_run_id"] == "run1"
    assert miss["annotator_kind"] == "CODE"

    # Context turns. The API wants strict user/assistant alternation starting
    # with user, so a half-present prior exchange is dropped rather than sent.
    bare = {"utterance": "Sounds good."}
    assert conversation(bare) == [{"role": "user", "content": "Sounds good."}]

    full = conversation(
        {
            "utterance": "Sounds good.",
            "prev_user": "Can you set up a habit for reading?",
            "prev_agent": "I can. Want the minimum to be one page?",
        }
    )
    assert [t["role"] for t in full] == ["user", "assistant", "user"]
    assert full[0]["content"] == "Can you set up a habit for reading?"
    assert full[2]["content"] == "Sounds good."

    half = {"utterance": "Sounds good.", "prev_user": "Set up a habit.", "prev_agent": ""}
    assert conversation(half) == [{"role": "user", "content": "Sounds good."}]
    other = {"utterance": "Sounds good.", "prev_user": "  ", "prev_agent": "Want one page?"}
    assert conversation(other) == [{"role": "user", "content": "Sounds good."}]

    # A Phoenix row must carry context too, or --phoenix scores blind.
    from_phoenix = example_to_row(
        {
            "id": "ex5",
            "input": {"utterance": "Yes, please.", "prev_user": "Add it?", "prev_agent": "Shall I?"},
        }
    )
    assert [t["role"] for t in conversation(from_phoenix)] == ["user", "assistant", "user"]

    # Instability. The whole point of MOO-574: runs that score identically are
    # not stable if their answers moved. Two of these four rows flip and the
    # flips cancel, so the aggregate range is 0.0 while the set is noisy.
    four = [{"utterance": u} for u in ("p", "q", "r", "s")]
    cancelling = [
        {"accuracy": 0.5, "predictions": ["a", "b", "c", "d"]},
        {"accuracy": 0.5, "predictions": ["a", "x", "y", "d"]},
    ]
    noisy = instability(four, cancelling)
    assert noisy["range"] == 0.0, "these runs really do score the same"
    assert noisy["unstable"] == 2
    assert [row["utterance"] for row, _ in noisy["flipped"]] == ["q", "r"]
    assert noisy["flipped"][0][1] == {"b", "x"}
    # The bar a change must clear comes from the flips, not from the range.
    assert noisy["band"] == math.sqrt(2) / 4
    assert noisy["band"] > noisy["range"]

    # A genuinely stable set gets a zero band — the number is not zero by
    # construction, it is zero only when nothing moved.
    two = [{"utterance": "p"}, {"utterance": "q"}]
    steady = instability(
        two,
        [
            {"accuracy": 0.5, "predictions": ["a", "b"]},
            {"accuracy": 0.5, "predictions": ["a", "b"]},
        ],
    )
    assert steady["unstable"] == 0
    assert steady["band"] == 0.0
    assert steady["flipped"] == []

    # The band scales with the flip count and shrinks with set size, so the
    # real 14-of-107 case lands near 3.5% rather than the 0.0% it reported.
    assert instability(four, cancelling)["band"] > instability(
        [{"utterance": str(i)} for i in range(8)],
        [
            {"accuracy": 0.5, "predictions": list("abcdefgh")},
            {"accuracy": 0.5, "predictions": list("abxdefgh")},
        ],
    )["band"]

    # Range stays reported, just demoted — it is still the observed evidence.
    swinging = instability(
        two,
        [
            {"accuracy": 1.0, "predictions": ["a", "b"]},
            {"accuracy": 0.5, "predictions": ["a", "x"]},
        ],
    )
    assert swinging["best"] == 1.0
    assert swinging["worst"] == 0.5
    assert swinging["range"] == 0.5

    print("selftest ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", metavar="NAME", help="save this run under a name")
    parser.add_argument("--compare", metavar="NAME", help="diff this run against a saved one")
    parser.add_argument(
        "--upload-dataset",
        nargs="?",
        const=DATASET,
        metavar="NAME",
        help=f"push labels.csv to Phoenix as a dataset (default {DATASET}) and exit",
    )
    parser.add_argument(
        "--phoenix",
        metavar="NAME",
        help="score the Phoenix dataset instead of the CSV and save the run as an experiment",
    )
    parser.add_argument(
        "--dataset",
        default=DATASET,
        metavar="NAME",
        help=f"which Phoenix dataset to use (default {DATASET})",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        metavar="N",
        help="score the set N times and report the noise band — the only honest way "
        "to read a delta on a model whose sampling cannot be pinned",
    )
    parser.add_argument("--selftest", action="store_true", help="check the pure logic and exit")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    if args.upload_dataset:
        rows = load_labels()
        dataset_id = upload_dataset(args.upload_dataset, rows)
        print(f"uploaded {len(rows)} examples to {args.upload_dataset} ({dataset_id})")
        return

    persona, tools = load_tools()

    version_id = dataset_id = None
    if args.phoenix:
        dataset_id = find_dataset(args.dataset)
        rows, version_id = load_phoenix_examples(dataset_id)
        unreviewed = sum(1 for r in rows if (r.get("reviewed") or "").lower() != "yes")
        if unreviewed:
            print(f"\n  WARNING: {unreviewed} of {len(rows)} Phoenix rows are not reviewed yet.\n")
    else:
        rows = load_labels()

    client = anthropic.Anthropic(api_key=env("ANTHROPIC_API_KEY"))

    print(f"scoring {len(rows)} utterances against {len(tools)} tools on {MODEL}")
    runs: list[dict] = []
    for attempt in range(1, args.repeat + 1):
        predictions = []
        timings = []
        for i, row in enumerate(rows, 1):
            started = dt.datetime.now(dt.timezone.utc)
            predictions.append(predict(client, persona, tools, row))
            timings.append((started.isoformat(), dt.datetime.now(dt.timezone.utc).isoformat()))
            label = f"run {attempt}/{args.repeat}  " if args.repeat > 1 else "  "
            print(f"\r{label}{i}/{len(rows)}", end="", flush=True)
        print()
        runs.append(score(rows, predictions))

    result = runs[-1]
    report(result)

    if args.repeat > 1:
        spread(rows, runs)

    if args.phoenix:
        push_experiment(
            args.phoenix, dataset_id, version_id, rows, predictions, timings, result, len(tools)
        )

    if args.save:
        path = EVALS / f"run-{args.save}.json"
        path.write_text(json.dumps(result, indent=2))
        print(f"\nsaved {path.name}")

    if args.compare:
        path = EVALS / f"run-{args.compare}.json"
        if not path.exists():
            raise SystemExit(f"No saved run called {args.compare}.")
        before = json.loads(path.read_text())
        delta = result["accuracy"] - before["accuracy"]
        arrow = "up" if delta > 0 else "down" if delta < 0 else "flat"
        print(f"\nvs {args.compare}: {before['accuracy']:.1%} -> {result['accuracy']:.1%} ({arrow} {abs(delta):.1%})")

        # Which individual utterances changed answer. This is the useful part —
        # a flat overall number can still hide two fixes and two regressions.
        for row, was, now in zip(rows, before.get("predictions", []), predictions):
            if was != now:
                print(f'  "{row["utterance"][:55]}"  {was} -> {now}')


if __name__ == "__main__":
    main()
