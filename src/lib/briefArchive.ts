// Briefs archive helpers (MOO-495): pure, shared by the /briefs rail and
// the find_brief voice tool. Client-safe — no server imports.

import { chicagoToday } from "../../convex/workflowLib.ts";

export type BriefSummary = {
  _id: string;
  _creationTime: number;
  title: string;
  workflowName: string;
  status: string;
  headings: string[];
  excerpt: string;
};

export type BriefKind = {
  key: "morning" | "review" | "research" | "browse" | "system";
  label: string;
  symbol: string;
};

const KINDS: Record<string, BriefKind> = {
  "morning-brief": { key: "morning", label: "MORNING", symbol: "☀" },
  "weekly-review": { key: "review", label: "REVIEW", symbol: "⟳" },
  "research-brief": { key: "research", label: "RESEARCH", symbol: "◎" },
  browse: { key: "browse", label: "BROWSE", symbol: "⌖" },
  "memory-consolidation": { key: "system", label: "SYSTEM", symbol: "⚙" },
};

export function briefKind(workflowName: string): BriefKind {
  return (
    KINDS[workflowName] ?? { key: "research", label: "RESEARCH", symbol: "◎" }
  );
}

// Tarik's rule: consolidation runs and errored runs are operational logs,
// not editions of the paper. This predicate is the ONE owner of that rule.
export function isSystemBrief(
  b: Pick<BriefSummary, "workflowName" | "status">,
): boolean {
  return briefKind(b.workflowName).key === "system" || b.status === "error";
}

export function splitBriefs<T extends Pick<BriefSummary, "workflowName" | "status">>(
  briefs: T[],
): { editorial: T[]; system: T[] } {
  return {
    editorial: briefs.filter((b) => !isSystemBrief(b)),
    system: briefs.filter(isSystemBrief),
  };
}

// One definition of "a Chicago day" — delegates to the workflow engine's.
export function chicagoDayKey(ms: number): string {
  return chicagoToday(new Date(ms));
}

export function chicagoDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Status → dot class, shared by the rail, the masthead folio, and Home.
export const BRIEF_STATUS_DOT: Record<string, string> = {
  ready: "bg-cyan-hud",
  building: "bg-amber pulse-soft",
  error: "bg-salmon",
};

function dayLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return "TODAY";
  if (key === yesterdayKey) return "YESTERDAY";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12))
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export type DayGroup<T> = { key: string; label: string; briefs: T[] };

export function groupBriefsByDay<T extends Pick<BriefSummary, "_creationTime">>(
  briefs: T[],
  nowMs: number,
): DayGroup<T>[] {
  const todayKey = chicagoDayKey(nowMs);
  const yesterdayKey = chicagoDayKey(nowMs - 24 * 60 * 60 * 1000);
  const groups = new Map<string, T[]>();
  for (const b of [...briefs].sort((a, z) => z._creationTime - a._creationTime)) {
    const key = chicagoDayKey(b._creationTime);
    let bucket = groups.get(key);
    if (!bucket) groups.set(key, (bucket = []));
    bucket.push(b);
  }
  return [...groups.entries()].map(([key, dayBriefs]) => ({
    key,
    label: dayLabel(key, todayKey, yesterdayKey),
    briefs: dayBriefs,
  }));
}

// Filler words score nothing — "the brief about the voyager thing" should
// rank on "voyager", not inflate wordy briefs on "the"/"about"/"thing".
const BRIEF_STOPWORDS = new Set([
  "the", "a", "an", "about", "brief", "briefs", "that", "this", "one",
  "thing", "from", "where", "with", "was", "were", "you", "your", "find",
]);

export function tokenize(query: string, stopwords: Set<string>): string[] {
  return query
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !stopwords.has(t));
}

// Token-overlap scoring: title hits weigh most, then headings, then excerpt.
// Good enough for the rail filter and for handing Zola a ranked candidate
// list — she does the actual semantic resolution.
export function scoreBrief(
  brief: Pick<BriefSummary, "title" | "headings" | "excerpt">,
  query: string,
): number {
  const tokens = tokenize(query, BRIEF_STOPWORDS);
  if (tokens.length === 0) return 0;
  const title = brief.title.toLowerCase();
  const headings = brief.headings.join(" ").toLowerCase();
  const excerpt = brief.excerpt.toLowerCase();
  return tokens.reduce((score, t) => {
    if (title.includes(t)) return score + 5;
    if (headings.includes(t)) return score + 3;
    if (excerpt.includes(t)) return score + 1;
    return score;
  }, 0);
}

// The one ranking pipeline for both the rail's search and find_brief —
// diverging thresholds here is how "Zola finds it but the rail doesn't"
// bugs would be born.
export function rankBriefs<T extends Pick<BriefSummary, "title" | "headings" | "excerpt">>(
  briefs: T[],
  query: string,
  limit: number,
): T[] {
  return briefs
    .map((b) => ({ b, score: scoreBrief(b, query) }))
    .filter((r) => r.score > 0)
    .sort((a, z) => z.score - a.score)
    .slice(0, limit)
    .map((r) => r.b);
}
