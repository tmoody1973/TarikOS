// Pure telos helpers — no Convex imports — usable from Convex functions,
// the import script, and tests (same pattern as workflowLib).

export const TELOS_KINDS = [
  "mission",
  "goal",
  "problem",
  "challenge",
  "strategy",
  "dimension",
] as const;

export const TELOS_STATUSES = [
  "active",
  "deferred",
  "done",
  "dropped",
] as const;

export type TelosKind = (typeof TELOS_KINDS)[number];

export type TelosStatus = (typeof TELOS_STATUSES)[number];

export type ParsedTelosItem = {
  kind: TelosKind;
  text: string;
  measurable?: string;
  status: TelosStatus;
};

export type TelosFile =
  | "MISSION"
  | "GOALS"
  | "PROBLEMS"
  | "CHALLENGES"
  | "STRATEGIES";

export const DEFAULT_CADENCE_DAYS: Record<TelosKind, number> = {
  mission: 365,
  goal: 30,
  problem: 90,
  challenge: 90,
  strategy: 90,
  dimension: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// PAI template placeholders are fully italic: `_like this_` (optionally with
// trailing punctuation stripped). A line whose content is one italic span is
// a stub, not data.
function isPlaceholder(text: string): boolean {
  const t = text.trim();
  return /^_[^_]*_?$/.test(t) || t === "";
}

// "Launch X — 3 shows by Oct 1" → text + measurable tail after the LAST em-dash.
function splitMeasurable(line: string): { text: string; measurable?: string } {
  const idx = line.lastIndexOf(" — ");
  if (idx === -1) return { text: line.trim() };
  return {
    text: line.slice(0, idx).trim(),
    measurable: line.slice(idx + 3).trim(),
  };
}

export function parseTelosFile(
  file: TelosFile,
  content: string,
): { items: ParsedTelosItem[]; skipped: string[] } {
  const lines = content.split("\n");
  const items: ParsedTelosItem[] = [];
  const skipped: string[] = [];
  let section = "";

  const push = (kind: TelosKind, raw: string, status: TelosStatus) => {
    const { text, measurable } = splitMeasurable(raw);
    if (isPlaceholder(text) || (measurable && isPlaceholder(measurable))) {
      skipped.push(raw.trim());
      return;
    }
    items.push({ kind, text, measurable, status });
  };

  if (file === "GOALS") {
    for (const line of lines) {
      const h = line.match(/^##\s+(.*)/);
      if (h) {
        section = h[1].toLowerCase();
        continue;
      }
      const checked = line.match(/^\s*-\s+\[(x| )\]\s+(.*)/i);
      const plain = line.match(/^\s*-\s+(?!\[)(.*)/);
      const deferred = /paused|deferred/.test(section);
      if (checked) {
        push("goal", checked[2], checked[1].toLowerCase() === "x" ? "done" : deferred ? "deferred" : "active");
      } else if (plain && deferred) {
        push("goal", plain[1], "deferred");
      }
    }
  } else if (file === "MISSION") {
    for (const line of lines) {
      const h = line.match(/^##\s+(.*)/);
      if (h) {
        section = h[1].toLowerCase();
        continue;
      }
      if (/current mission/.test(section) && line.trim() && !line.startsWith("#")) {
        push("mission", line, "active");
      } else if (/themes/.test(section)) {
        const bullet = line.match(/^\s*-\s+(.*)/);
        if (bullet) push("mission", bullet[1], "active");
      }
    }
  } else if (file === "PROBLEMS" || file === "CHALLENGES") {
    const kind: TelosKind = file === "PROBLEMS" ? "problem" : "challenge";
    // ### Title blocks under the active section; first bold field line
    // (Statement/Nature) enriches the text.
    let inActive = false;
    let title: string | null = null;
    let detail: string | null = null;
    const flush = () => {
      if (title !== null) {
        push(kind, detail ? `${title}: ${detail}` : title, "active");
      }
      title = null;
      detail = null;
    };
    for (const line of lines) {
      const h2 = line.match(/^##\s+(.*)/);
      if (h2) {
        flush();
        inActive = /active|current/i.test(h2[1]);
        continue;
      }
      const h3 = line.match(/^###\s+(.*)/);
      if (h3) {
        flush();
        if (inActive) {
          if (isPlaceholder(h3[1])) skipped.push(h3[1].trim());
          else title = h3[1].trim();
        }
        continue;
      }
      const field = line.match(/^\s*-\s+\*\*(?:Statement|Nature):\*\*\s+(.*)/);
      if (field && title && !detail && !isPlaceholder(field[1])) {
        detail = field[1].trim();
      }
    }
    flush();
  } else if (file === "STRATEGIES") {
    let inActive = false;
    for (const line of lines) {
      const h2 = line.match(/^##\s+(.*)/);
      if (h2) {
        inActive = /active/i.test(h2[1]);
        continue;
      }
      if (!inActive || !line.trim().startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      // header, separator, and placeholder rows are not strategies
      if (cells.length < 4 || cells[0] === "Domain" || /^-+$/.test(cells[0])) continue;
      if (cells.some((c) => isPlaceholder(c))) {
        skipped.push(line.trim());
        continue;
      }
      const [domain, strategy, , status] = cells;
      items.push({
        kind: "strategy",
        text: `${strategy} (${domain})`,
        status: /paused/i.test(status) ? "deferred" : "active",
      });
    }
  }

  return { items, skipped };
}

// ---- Staleness + summary ----

export function isStale(
  item: { reviewedAt: number; reviewCadenceDays: number },
  now: number,
): boolean {
  return now - item.reviewedAt > item.reviewCadenceDays * DAY_MS;
}

export type SummaryItem = {
  kind: TelosKind;
  text: string;
  measurable?: string;
  status: TelosStatus;
  reviewedAt: number;
  reviewCadenceDays: number;
};

const SUMMARY_SECTIONS: { kind: TelosKind; heading: string }[] = [
  { kind: "mission", heading: "Mission" },
  { kind: "goal", heading: "Active goals" },
  { kind: "problem", heading: "Problems being worked" },
  { kind: "challenge", heading: "Challenges" },
  { kind: "strategy", heading: "Strategies" },
];

export function compileTelosSummary(items: SummaryItem[], now: number): string {
  const active = items.filter((i) => i.status === "active");
  if (active.length === 0) return "";
  const parts: string[] = [];
  for (const { kind, heading } of SUMMARY_SECTIONS) {
    const rows = active.filter((i) => i.kind === kind);
    if (rows.length === 0) continue;
    parts.push(
      `${heading}:\n` +
        rows
          .map((i) => {
            const m = i.measurable ? ` (measurable: ${i.measurable})` : "";
            const stale = isStale(i, now) ? " [stale — review due]" : "";
            return `- ${i.text}${m}${stale}`;
          })
          .join("\n"),
    );
  }
  return parts.join("\n");
}
