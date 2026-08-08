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

This is not the ElevenLabs agent loop. Different serving, no audio, no
conversation history. Absolute numbers will not match production. What
transfers is the *delta* when you rewrite a description, and the delta is the
thing you iterate on. Use Phoenix traces for the true baseline.
"""

import argparse
import collections
import csv
import datetime as dt
import functools
import json
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
            "inputs": [{"utterance": r["utterance"]} for r in rows],
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
    return {
        "example_id": example["id"],
        "utterance": (example.get("input") or {}).get("utterance", ""),
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


def predict(client, persona: str, tools: list[dict], utterance: str) -> str:
    """Return the tool the model reaches for, or 'none' if it just answers."""
    message = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=persona,
        tools=tools,
        messages=[{"role": "user", "content": utterance}],
    )
    for block in message.content:
        if block.type == "tool_use":
            return block.name
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
    predictions: list[str] = []
    timings: list[tuple[str, str]] = []
    for i, row in enumerate(rows, 1):
        started = dt.datetime.now(dt.timezone.utc)
        predictions.append(predict(client, persona, tools, row["utterance"]))
        timings.append((started.isoformat(), dt.datetime.now(dt.timezone.utc).isoformat()))
        print(f"\r  {i}/{len(rows)}", end="", flush=True)
    print()

    result = score(rows, predictions)
    report(result)

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
