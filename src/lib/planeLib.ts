// Extension included deliberately: this module is exercised by `node --test`,
// whose ESM loader does not resolve a bare specifier the way Next does.
import { scoreMatch } from "../../convex/studioLib.ts";

// Plane's pure logic: everything that can be decided without a network.
//
// Separate from plane.ts, which is the only file that talks to the API, for the
// same reason contactsLib is separate from googlePeople — a board's column
// order and a spoken status line are rules worth testing, and they should not
// need a token to run.
//
// Two shapes here came from the live API rather than its documentation, and
// both are load-bearing:
//
//   · A state's NAME is customisable per project; its `group` is not. Group is
//     the only stable key a board can be built on.
//   · `state` is documented as required when creating a work item. It is not.
//     An item created with only a name lands in the project's default state,
//     which is what makes a title-only voice capture one round trip instead of
//     two.
//
// Vocabulary: Plane's API says "issues"; its UI says "work items". This
// codebase says WORK ITEM everywhere except inside a URL, so a reader only has
// to hold one word.

/** The five state groups Plane defines. Names vary; these do not. */
export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type StateGroup = (typeof STATE_GROUPS)[number];

export type PlaneState = { id: string; name: string; group: StateGroup };

export type PlaneWorkItem = {
  id: string;
  name: string;
  state: string;
  state_group: StateGroup;
  priority: string;
  sequence_id: number;
  target_date: string | null;
};

export type PlaneProject = { id: string; name: string; identifier: string };

/** What Plane accepts. Anything else makes it reject the whole request. */
const PRIORITIES = ["urgent", "high", "medium", "low", "none"];

/** Long enough to say something, short enough to read in a board card. */
const TITLE_MAX = 255;

/** The POST body for a new work item, or a reason it cannot be built. */
export function workItemPayload(input: {
  title: string;
  description?: string;
  priority?: string;
}):
  | { ok: true; payload: { name: string; description?: string; priority?: string } }
  | { ok: false; error: string } {
  const name = (input.title ?? "").trim().slice(0, TITLE_MAX);
  // Everything else about a work item is optional to Plane. A name is not
  // optional to a person: a nameless row cannot be identified in any list,
  // spoken or on screen.
  if (!name) return { ok: false, error: "A task needs to say what it is." };

  const payload: { name: string; description?: string; priority?: string } = { name };

  const description = (input.description ?? "").trim();
  if (description) payload.description = description;

  // An unrecognised priority is DROPPED rather than passed through. Plane
  // rejects the whole request on one it does not know, so a single stray word
  // in a spoken sentence would lose the task instead of the priority.
  const priority = (input.priority ?? "").trim().toLowerCase();
  if (PRIORITIES.includes(priority) && priority !== "none") payload.priority = priority;

  // No `state`. Omitting it lands the item in the project's default, which
  // saves resolving a state id mid-sentence. Verified against the live API.
  return { ok: true, payload };
}

/** The words that mean yes. Everything else, including silence, means no. */
const AFFIRMATIVE = new Set(["true", "yes", "y", "go ahead", "confirmed", "do it"]);

/**
 * Did the caller actually confirm?
 *
 * Written after this shipped broken. The route tested `body.confirmed !== true`
 * and every property in the agent's tool schema is declared as a STRING, so the
 * flag arrived as `"true"` and the test could never pass. Tarik said yes, Zola
 * sent the flag, and the server handed back the blueprint again — forever. She
 * could not confirm at all.
 *
 * So the check is by VALUE rather than by type, since the transport decides the
 * type and this code does not control the transport. A boolean still works, for
 * the board and anything else speaking real JSON.
 *
 * Deliberately narrow on the other side: absence, empty, "false", "no" and
 * anything unrecognised are NOT confirmation. The blueprint exists to stop a
 * project being created by accident, and a loose truthiness test would let
 * `confirmed: "not yet"` create one.
 */
export function isConfirmed(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return AFFIRMATIVE.has(value.trim().toLowerCase());
}

export type BoardColumn = {
  group: StateGroup;
  /** The project's own name for this group, e.g. "Todo" or "Next up". */
  name: string;
  items: PlaneWorkItem[];
};

/**
 * The board: one column per state group, left to right in the order work
 * actually moves.
 *
 * Grouped by GROUP, never by state name. A project can rename Todo to anything
 * it likes and Plane returns states in no useful order; the group is the only
 * thing that survives both.
 *
 * Several states can share a group — a project with "In Progress" and "In
 * Review" has two started states — and they collapse into one column, because
 * five columns holding one card each is not a board.
 *
 * A column with no work still renders. Otherwise the board's shape changes as
 * work moves through it and a column disappears the moment it empties.
 */
export function boardColumns(
  states: PlaneState[],
  items: PlaneWorkItem[],
): BoardColumn[] {
  const columns: BoardColumn[] = STATE_GROUPS.map((group) => ({
    group,
    // The project's own vocabulary, so the board reads the way Plane does.
    // Falls back to the group when a project has no state in it at all.
    name: states.find((s) => s.group === group)?.name ?? group,
    items: [],
  }));

  const byGroup = new Map(columns.map((c) => [c.group, c]));
  for (const workItem of items) {
    // An unrecognised group goes to backlog rather than nowhere. Showing work
    // in the wrong column is recoverable; losing it off the board is not.
    (byGroup.get(workItem.state_group) ?? columns[0]).items.push(workItem);
  }
  return columns;
}

/** A word for a count that reads aloud without sounding like a report. */
function countPhrase(n: number, noun: string): string {
  return `${n} ${noun}`;
}

/**
 * What Zola says when asked how a project is going.
 *
 * A sentence, not a table. She speaks this into a phone call, so a newline or a
 * pipe is machinery leaking into a conversation.
 *
 * Finished work is not reported as outstanding, and an empty project is
 * described as empty rather than as a row of zeroes — "nothing in it yet" is
 * an answer; "0 in progress, 0 waiting, 0 done" is a form.
 */
export function describeStatus(projectName: string, items: PlaneWorkItem[]): string {
  const started = items.filter((i) => i.state_group === "started");
  const waiting = items.filter(
    (i) => i.state_group === "backlog" || i.state_group === "unstarted",
  );
  const done = items.filter((i) => i.state_group === "completed");

  if (items.length === 0) return `${projectName} has nothing in it yet.`;
  if (started.length === 0 && waiting.length === 0) {
    return `Everything in ${projectName} is finished or dropped.`;
  }

  const parts: string[] = [];
  if (started.length) parts.push(countPhrase(started.length, "in progress"));
  if (waiting.length) parts.push(countPhrase(waiting.length, "waiting"));
  if (done.length) parts.push(countPhrase(done.length, "done"));

  const lead = `${projectName}: ${parts.join(", ")}.`;
  // Name what is actually moving. A count alone tells him nothing he can act
  // on; the titles are the reason he asked.
  const naming = started.slice(0, 3).map((i) => i.name).join(", ");
  return started.length ? `${lead} In flight: ${naming}.` : lead;
}

/**
 * The projects that could be the one he meant, best first.
 *
 * Scored with `scoreMatch` — the same rule behind the Studio source picker and
 * recall. Three surfaces, one answer to "which one did he mean", because a
 * second implementation would eventually disagree and the disagreement shows up
 * as the wrong project being written to.
 *
 * The identifier counts as part of the name: he says "MOODY" as often as he
 * says "Moody and Co".
 */
export function rankProjects(projects: PlaneProject[], query: string): PlaneProject[] {
  return projects
    // Scored SEPARATELY against the name and the identifier, then best wins.
    // Concatenating them destroys the exact-match score that ranks "Pledge
    // drive" above "Pledge drive planning" — no query equals both at once.
    .map((p) => ({
      p,
      score: Math.max(scoreMatch(p.name, "", query), scoreMatch(p.identifier, "", query)),
    }))
    .filter((r) => r.score > 0)
    .sort((a, z) => z.score - a.score || a.p.id.localeCompare(z.p.id))
    .map((r) => r.p);
}
