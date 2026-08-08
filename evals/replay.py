"""Score tool selection against your labeled utterances, in seconds.

    python evals/replay.py                    # score, print accuracy + confusion matrix
    python evals/replay.py --save before      # save the run so you can diff against it
    python evals/replay.py --compare before   # score again and show what moved

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
import json
import os
import pathlib

import anthropic

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVALS = ROOT / "evals"
MODEL = "claude-sonnet-5"  # the model the live agent runs on


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
        alternatives = {
            a.strip()
            for a in (row.get("acceptable_alternatives") or "").split(";")
            if a.strip()
        }
        ok = got == expected or got in alternatives
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", metavar="NAME", help="save this run under a name")
    parser.add_argument("--compare", metavar="NAME", help="diff this run against a saved one")
    args = parser.parse_args()

    persona, tools = load_tools()
    rows = load_labels()
    client = anthropic.Anthropic(api_key=env("ANTHROPIC_API_KEY"))

    print(f"scoring {len(rows)} utterances against {len(tools)} tools on {MODEL}")
    predictions = []
    for i, row in enumerate(rows, 1):
        predictions.append(predict(client, persona, tools, row["utterance"]))
        print(f"\r  {i}/{len(rows)}", end="", flush=True)
    print()

    result = score(rows, predictions)
    report(result)

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
