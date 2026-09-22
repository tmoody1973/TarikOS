import type {
  BuiltInVoice,
  MediaSessionConfig,
} from "openai/resources/live/live";

/* GPT-Live session config for Zola (phase 0 of the migration in
 * docs/new-feat-research/2026-09-22-gpt-live-migration-plan.md).
 *
 * Two prompts, on purpose. GPT-Live is the voice: it listens, speaks, and
 * decides when to hand work to a backend. The backend model reasons and picks
 * tools. OpenAI's migration guide says not to paste one prompt into both, so
 * the persona's tone lives here and its tool judgement will move to the
 * backend prompt in phase 1. The three policy headings are the ones the
 * prompting guide asks you to keep verbatim.
 *
 * Keep this module free of import-time env reads: textTools.ts avoids
 * importing provision-agent.ts for that reason, and phase 1 wants to derive
 * the text tool list from the TOOLS that will live here. */

export const LIVE_MODEL = "gpt-live-1";
export const BACKEND_MODEL = "gpt-5.6-terra";
// From the model page: voice sessions bill per second at this rate.
export const LIVE_USD_PER_MINUTE = 0.05;

/* A type cannot produce a runtime array, and the route needs the values to
 * check a requested voice. So the list is written out, and `satisfies` makes
 * the compiler fail if the SDK's BuiltInVoice union gains or loses a name.
 * marin first: it is the documented default. */
const VOICES = {
  marin: true,
  cedar: true,
  alloy: true,
  ash: true,
  ballad: true,
  coral: true,
  echo: true,
  sage: true,
  shimmer: true,
  verse: true,
  quartz: true,
  ripple: true,
  vesper: true,
  willow: true,
  stone: true,
  gleam: true,
  meridian: true,
  bossa: true,
  tempo: true,
  beacon: true,
  delta: true,
  cinder: true,
} satisfies Record<BuiltInVoice, true>;

export type LiveVoice = BuiltInVoice;
export const LIVE_VOICES = Object.keys(VOICES) as LiveVoice[];
export const DEFAULT_VOICE: LiveVoice = "marin";

export function isLiveVoice(value: unknown): value is LiveVoice {
  return typeof value === "string" && value in VOICES;
}

export const VOICE_INSTRUCTIONS = `You are Zola, Tarik Moody's personal AI: his chief of staff, second brain, and thought partner. Tarik is an architect-trained radio host and technologist in Milwaukee. Speak with calm, wry confidence, like a trusted first officer: direct, warm, never sycophantic, occasionally dry-humored. Keep replies to one to three sentences unless he asks you to go deeper. No lists. Never open with praise, agreement, or a restatement of what he just said; start with the thing itself.

Backchannel policy: Use light backchannels. A brief acknowledgment while he is still talking is fine. Never compete with his sentence.

Interruption policy: Stop speaking when Tarik interrupts. Listen to what he says.

Delegation policy:
Backend tools:
- Web search: current facts, news, and anything you would otherwise have to guess.

Delegate to the backend when:
- The answer needs current information or careful reasoning.

Do not delegate to the backend when:
- You can answer from the conversation or a still-current result.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;

export const BACKEND_INSTRUCTIONS = `You support Zola in a live voice conversation with Tarik Moody. Transcripts can contain mistakes, unfinished phrases, and later corrections; use the latest context. Use web search when current facts are needed. Return concise, grounded results for a spoken conversation: the relevant facts and where they came from, nothing more.`;

/* Accent is a prompt-level lever. The custom-voices guide says to name the
 * accent in session.instructions ("Speak British English"); the built-in
 * voices have no other knob. Plain words only, short, so a user cannot smuggle
 * instructions through it. */
export const ACCENT_MAX_LENGTH = 40;
export const ACCENT_PATTERN = /^[A-Za-z][A-Za-z ]*$/;

export function isAccent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ACCENT_MAX_LENGTH &&
    ACCENT_PATTERN.test(value)
  );
}

export type LiveSessionOptions = {
  voice?: LiveVoice;
  accent?: string;
};

export function buildLiveSessionConfig({
  voice = DEFAULT_VOICE,
  accent,
}: LiveSessionOptions = {}): MediaSessionConfig {
  const instructions = accent
    ? `${VOICE_INSTRUCTIONS}\n\nSpeak ${accent.trim()} English.`
    : VOICE_INSTRUCTIONS;
  return {
    model: LIVE_MODEL,
    instructions,
    audio: { output: { voice } },
    delegation: {
      type: "responses",
      responses: {
        model: BACKEND_MODEL,
        instructions: BACKEND_INSTRUCTIONS,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
      },
    },
  };
}

/* Transcript fragments arrive for both speakers, possibly interleaved, and a
 * fragment is not a turn. Group consecutive fragments from one speaker into a
 * turn. Roles match convex/transcripts.ts so phase 1 can append these
 * directly. Pure: returns a new array, never mutates. */
export type TurnRole = "tarik" | "morpheus";
export type Turn = { role: TurnRole; text: string };

export function appendDelta(
  turns: readonly Turn[],
  role: TurnRole,
  delta: string,
): Turn[] {
  const last = turns[turns.length - 1];
  if (last?.role === role) {
    return [...turns.slice(0, -1), { role, text: last.text + delta }];
  }
  return [...turns, { role, text: delta }];
}
