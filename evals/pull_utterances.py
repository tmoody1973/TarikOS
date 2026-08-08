"""Pull real utterances out of past ElevenLabs conversations into a CSV you label by hand.

    python evals/pull_utterances.py

Writes evals/labels-draft.csv (gitignored). Every row is something you actually
said, paired with the tool Zola actually reached for. That second column is a
starting point, not an answer key — the whole point of the eval is that she
sometimes picks the wrong one. You go through the file and fill in what she
*should* have done.

Why this exists: ElevenLabs keeps every conversation, so the dataset you need
for the tool-selection eval is already sitting in your account. You don't have
to wait weeks to collect it.
"""

import csv
import json
import os
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "evals" / "labels-draft.csv"
API = "https://api.elevenlabs.io/v1/convai"


def env(name: str) -> str:
    """Read a key from .env.local, falling back to the real environment."""
    for line in (ROOT / ".env.local").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is missing from .env.local")
    return value


def get(url: str, key: str) -> dict:
    req = urllib.request.Request(url, headers={"xi-api-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main() -> None:
    key, agent = env("ELEVENLABS_API_KEY"), env("ELEVENLABS_AGENT_ID")

    listing = get(f"{API}/conversations?agent_id={agent}&page_size=100", key)
    conversations = listing.get("conversations", [])
    print(f"{len(conversations)} conversations on the account")

    rows = []
    for summary in conversations:
        cid = summary["conversation_id"]
        detail = get(f"{API}/conversations/{cid}", key)
        transcript = detail.get("transcript") or []

        # Walk forward from each user turn and collect any tool the agent
        # reached for before the next thing you said. That window is the
        # decision the eval is scoring.
        for i, turn in enumerate(transcript):
            if turn.get("role") != "user":
                continue
            said = (turn.get("message") or "").strip()
            if not said:
                continue

            called = []
            for later in transcript[i + 1 :]:
                if later.get("role") == "user":
                    break
                for call in later.get("tool_calls") or []:
                    name = call.get("tool_name")
                    if name and name not in called:
                        called.append(name)

            rows.append(
                {
                    "utterance": said,
                    "actually_called": ";".join(called) or "none",
                    # Pre-filled from what she actually did, which is a fast
                    # starting point and a terrible answer key — she is
                    # sometimes wrong, and that is the whole point. Flip
                    # `reviewed` to yes once you have checked a row.
                    "expected_tool": ";".join(called[:1]) or "none",
                    "acceptable_alternatives": "",
                    "reviewed": "no",
                    "conversation_id": cid,
                }
            )

    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "utterance",
                "actually_called",
                "expected_tool",
                "acceptable_alternatives",
                "reviewed",
                "conversation_id",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    with_tool = sum(1 for r in rows if r["actually_called"] != "none")
    print(f"Wrote {OUT} — {len(rows)} utterances, {with_tool} of them called a tool")
    print("Next: open it, fill in expected_tool on the ones worth scoring, save as labels.csv")


if __name__ == "__main__":
    main()
