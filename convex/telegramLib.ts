// When a text exchange is still the same conversation.
//
// Lives in convex/ for the same reason documentsLib does: Convex mutations
// cannot import from src/, but the Next routes can import from here. Pure and
// dependency-free so the windowing rules can be tested directly.

/** Turns kept in context. Six exchanges is enough for "what about tomorrow?" */
export const MAX_CONTEXT_TURNS = 12;

/**
 * A gap this long ends the conversation.
 *
 * Not a fixed TTL: a thread that has been going for an hour is still one
 * thread, and a question asked the next morning is not a continuation of last
 * night's however recently it was stored. What matters is the silence between
 * messages, not the age of the first one.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Longer than this and it is a document, not a text message. */
export const MAX_TURN_CHARS = 4000;

export type Turn = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

/**
 * The turns that belong to the conversation happening now, oldest first.
 *
 * Walks backwards from the most recent and stops at the first silence longer
 * than the gap — so a burst from this morning does not lead a question asked
 * this afternoon, and half an exchange is never carried without its other half.
 */
export function selectContextTurns(turns: Turn[], now: number): Turn[] {
  const ordered = [...turns].sort((a, b) => a.createdAt - b.createdAt);
  const kept: Turn[] = [];

  let next = now;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const turn = ordered[i];
    if (next - turn.createdAt > SESSION_GAP_MS) break;
    kept.unshift(turn);
    next = turn.createdAt;
    if (kept.length >= MAX_CONTEXT_TURNS) break;
  }

  // Never open on an assistant turn: a model handed someone else's answer as
  // the start of a conversation treats it as its own and doubles down on it.
  while (kept.length > 0 && kept[0].role === "assistant") kept.shift();

  return kept;
}

/** Stored text, bounded. */
export function trimTurn(content: string): string {
  const clean = content.trim();
  return clean.length <= MAX_TURN_CHARS ? clean : clean.slice(0, MAX_TURN_CHARS);
}
