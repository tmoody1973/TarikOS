// Muting the robots.
//
// The inbox panel asks Gmail for six messages per account. Four of Tarik's
// were automated pipeline reports, so the panel was almost entirely machine
// chatter and real mail never made the cut.
//
// The filtering belongs in the GMAIL QUERY rather than in a pass over the
// results. Excluded there, a muted message never costs one of the six slots,
// never reaches the morning brief, and is never read out by Zola — three
// surfaces fixed by one string. Filtering afterwards would fix only the panel
// and still let the noise eat the budget.
//
// Lives in convex/ like the other shared libs, because the mute list is a
// Convex setting and the query is built where the setting is read.

/** What the inbox asked for before anything was muted. */
export const BASE_INBOX_QUERY = "in:inbox category:primary newer_than:1d";

export type MuteList = {
  senders: string[];
  subjects: string[];
};

/**
 * Gmail rejects very long queries, and a rejected query returns NO mail —
 * a mute list that silently empties the inbox is far worse than the noise it
 * was meant to remove. Well under Gmail's own limit, with room for the base.
 */
const MAX_QUERY_CHARS = 1800;

function clean(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    // Gmail matches case-insensitively, so two spellings are one rule and
    // sending both only spends query length.
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Quote a subject so spaces stay inside one term.
 *
 * Unquoted, `-subject:OK Q1-HOURLY` excludes anything containing "OK" and then
 * separately searches for "Q1-HOURLY", which hides most of the inbox. Inner
 * quotes are replaced rather than escaped — Gmail has no escape syntax, so a
 * stray quote would end the term early and turn the rest into loose search
 * words.
 */
function quoted(subject: string): string {
  return `"${subject.replace(/"/g, "'")}"`;
}

export function buildInboxQuery(
  mutes: MuteList,
  options?: { detail?: false },
): string;
export function buildInboxQuery(
  mutes: MuteList,
  options: { detail: true },
): { query: string; dropped: number };
/**
 * The Gmail query for the inbox, with every mute applied.
 *
 * Truncates rather than risking a rejected query, and reports how many rules
 * were dropped so a rule that does nothing is visible instead of mysterious.
 */
export function buildInboxQuery(
  mutes: MuteList,
  options?: { detail?: boolean },
): string | { query: string; dropped: number } {
  const terms = [
    ...clean(mutes?.senders).map((s) => `-from:${s}`),
    ...clean(mutes?.subjects).map((s) => `-subject:${quoted(s)}`),
  ];

  let query = BASE_INBOX_QUERY;
  let used = 0;
  for (const term of terms) {
    if (query.length + 1 + term.length > MAX_QUERY_CHARS) break;
    query = `${query} ${term}`;
    used++;
  }

  return options?.detail ? { query, dropped: terms.length - used } : query;
}
