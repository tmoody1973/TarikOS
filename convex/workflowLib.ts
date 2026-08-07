// Pure workflow-engine helpers: template resolution, step fan-out, and
// tool-result → brief-section formatting. No Convex imports so the logic is
// unit-testable with plain `node --test` (see tests/workflowLib.test.ts).

export type StepDef = { tool: string; args: Record<string, string> };
export type ResolvedStep = {
  tool: string;
  args: Record<string, string>;
  label: string;
};
export type FeedGroup = { label: string; feeds: string[] };
export type TemplateVars = {
  today: string;
  topics: string[];
  topic?: string;
  feedGroups?: FeedGroup[];
};
export type ToolResult = { ok: boolean; message: string; data?: unknown };
export type Source = { title: string; url: string };
export type SectionInput = {
  heading: string;
  body: string;
  tool: string;
  sources: Source[];
};

// Deployment-specific; set TOOL_BASE_URL in the Convex deployment env.
export const TOOL_BASE_URL =
  process.env.TOOL_BASE_URL ?? "http://localhost:3000/api/tools";

const TOOL_LABELS: Record<string, string> = {
  get_calendar: "Calendar",
  get_emails: "Inbox",
  telos_brief: "Goals",
  journal_digest: "This Week's Journal",
};

function labelFor(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, " ");
}

function resolveValue(value: string, vars: TemplateVars): string {
  return value
    .replaceAll("{{today}}", vars.today)
    .replaceAll("{{topic}}", vars.topic ?? "");
}

/**
 * Resolve one workflow step definition into concrete tool calls. A step whose
 * args mention {{topics}} fans out into one call per standing topic (labeled
 * by the topic); other steps resolve {{today}}/{{topic}} in place.
 */
export function expandSteps(
  steps: StepDef[],
  vars: TemplateVars,
): ResolvedStep[] {
  return steps.flatMap((step) => {
    const argValues = Object.values(step.args);
    if (argValues.some((val) => val.includes("{{feedGroups}}"))) {
      // Fan out into one call per feed group; the route gets the group's
      // feed URLs space-joined, the section takes the group's label.
      return (vars.feedGroups ?? []).map((group) => ({
        tool: step.tool,
        args: { label: group.label, feeds: group.feeds.join(" ") },
        label: group.label,
      }));
    }
    const usesTopics = argValues.some((val) => val.includes("{{topics}}"));
    if (!usesTopics) {
      const args = Object.fromEntries(
        Object.entries(step.args).map(([k, val]) => [
          k,
          resolveValue(val, vars),
        ]),
      );
      // A research step's query makes a better section heading than "web research".
      const label =
        step.tool === "web_research" && args.query
          ? args.query
          : labelFor(step.tool);
      return [{ tool: step.tool, args, label }];
    }
    return vars.topics.map((topic) => ({
      tool: step.tool,
      args: Object.fromEntries(
        Object.entries(step.args).map(([k, val]) => [
          k,
          resolveValue(val.replaceAll("{{topics}}", topic), vars),
        ]),
      ),
      label: topic,
    }));
  });
}

export function chicagoToday(now: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function chicagoTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
      });
}

// Truncation that never cuts an emoji in half: a bare .slice() can split a
// surrogate pair, and Convex rejects strings with lone surrogates.
export function safeSlice(raw: string, max: number): string {
  const sliced = raw.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced;
}

// Tool snippets (Tavily etc.) arrive with raw markdown artifacts — headings,
// emphasis marks, links, hard newlines. Scrub to plain prose for brief bodies.
export function cleanText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteHttpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type CalendarEvent = {
  title?: string;
  start?: string;
  allDay?: boolean;
  location?: string;
  account?: string;
};
type Email = {
  subject?: string;
  from?: string;
  account?: string;
  snippet?: string;
};
type ResearchHit = { title?: string; snippet?: string; url?: string };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Turn one tool call's result into a brief section (markdown body + sources). */
export function formatSection(
  step: ResolvedStep,
  result: ToolResult,
): { section: Omit<SectionInput, "tool"> & { tool: string }; isError: boolean } {
  const base = { heading: step.label, tool: step.tool };
  if (!result.ok) {
    return {
      section: { ...base, body: `⚠️ ${result.message}`, sources: [] },
      isError: true,
    };
  }
  const data = asRecord(result.data);

  // Tools that pre-build their own markdown (telos_brief, journal_digest, …)
  // hand it over as data.body.
  if (typeof data.body === "string" && data.body) {
    return { section: { ...base, body: data.body, sources: [] }, isError: false };
  }

  if (step.tool === "get_calendar") {
    const events = (Array.isArray(data.events) ? data.events : []) as CalendarEvent[];
    const body =
      events.length === 0
        ? result.message
        : events
            .map(
              (e) =>
                `- ${e.allDay ? "All day" : chicagoTime(e.start ?? "")} · ${e.title ?? "(untitled)"}${e.location ? ` · ${e.location}` : ""}${e.account ? ` (${e.account})` : ""}`,
            )
            .join("\n");
    return { section: { ...base, body, sources: [] }, isError: false };
  }

  if (step.tool === "get_emails") {
    const emails = (Array.isArray(data.emails) ? data.emails : []) as Email[];
    const body =
      emails.length === 0
        ? result.message
        : emails
            .map(
              (e) =>
                `- **${cleanText(e.subject ?? "") || "(no subject)"}** — ${e.from ?? "unknown"}${e.account ? ` (${e.account})` : ""}: ${safeSlice(cleanText(e.snippet ?? ""), 140)}`,
            )
            .join("\n");
    return { section: { ...base, body, sources: [] }, isError: false };
  }

  const results = (Array.isArray(data.results) ? data.results : []) as ResearchHit[];
  if (results.length > 0) {
    // Headline IS the link — [title](url) renders as a reader-pane link in
    // the UI, so no separate sources footer is needed per section. Search
    // engines sometimes return relative redirect paths (/goto?url=…) as
    // "urls" — only absolute http(s) URLs become links.
    const body = results
      .map((r) => {
        const title =
          cleanText(r.title ?? "").replace(/[[\]]/g, "") || "(untitled)";
        const url = absoluteHttpUrl(r.url);
        const head = url ? `[${title}](${url})` : `**${title}**`;
        return `- ${head} — ${safeSlice(cleanText(r.snippet ?? ""), 220)}`;
      })
      .join("\n");
    const sources = results.flatMap((r) => {
      const url = absoluteHttpUrl(r.url);
      return url ? [{ title: cleanText(r.title ?? "") || url, url }] : [];
    });
    return { section: { ...base, body, sources }, isError: false };
  }

  return {
    section: { ...base, body: result.message, sources: [] },
    isError: false,
  };
}

export function workflowTitle(name: string, today: string): string {
  const human = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${human} — ${today}`;
}
