// The morning brief, rendered for a phone.
//
// The brief itself is not built here — a cron already builds one every weekday
// and writes it to the Briefs page (convex/crons.ts -> workflowRunner). This
// only turns the finished sections into one Telegram message, so the first
// thing he sees in the morning is the brief rather than a reminder that a
// brief exists.
//
// Everything in here is untrusted text. Headings are tool labels, bodies carry
// Gmail subjects, calendar titles and search snippets — none of it authored by
// this app. A single bare `<` makes Telegram reject the WHOLE message, so the
// rule is absolute: escape every interpolated value, and let this file be the
// only thing that writes a tag.

import { escapeHtml, MAX_REPLY } from "./telegram.ts";

export type DigestSection = { heading: string; body: string };

/** Sections whose body the workflow runner marked as a failure. */
const ERROR_MARK = "⚠️";

/** Reserved for the trailing "trimmed" note, so it always survives the cut. */
const TAIL = "\n\n… more on the dashboard.";

/** In-app-only host (MAIL_LINK_HOST); a dead link on a phone. */
const INTERNAL_HOST = "tarikos.internal";

/** Lines this long or longer get shortened before the whole digest is cut. */
const MAX_LINE = 180;

function linkable(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname === INTERNAL_HOST ? null : url.href;
  } catch {
    return null;
  }
}

/**
 * One brief line, escaped, with markdown links turned into real ones.
 *
 * The bodies arrive as the markdown the Briefs page renders — `[title](url)`
 * for mail threads and search hits. Left alone those read as literal brackets
 * on a phone. Escaping happens per-piece so the href and the label are both
 * safe and the anchor itself is still markup.
 */
function renderLine(line: string): string {
  const shortened =
    line.length > MAX_LINE ? `${line.slice(0, MAX_LINE).trimEnd()}…` : line;

  let out = "";
  let rest = shortened;
  // A link or a bold run, whichever comes first. formatSection emits **bold**
  // for every mail row it could not link to a thread, so unhandled asterisks
  // are the common case rather than an edge one.
  const markup = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*/;

  for (let match = markup.exec(rest); match; match = markup.exec(rest)) {
    out += escapeHtml(rest.slice(0, match.index));
    if (match[3] !== undefined) {
      out += `<b>${escapeHtml(match[3])}</b>`;
    } else {
      const href = linkable(match[2]);
      // A url we will not link to still keeps its label — the subject line is
      // the useful part, and a dead link is worse than plain text.
      out += href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(match[1])}</a>`
        : escapeHtml(match[1]);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out + escapeHtml(rest);
}

/**
 * Build the message, or "" when there is nothing worth sending.
 *
 * Failed sections are dropped rather than reported: the runner keeps building
 * a partial brief when a step errors, and a morning text that is only "Gmail
 * token expired" is worse than no text. The dashboard still shows the failure.
 */
export function briefDigest(title: string, sections: DigestSection[]): string {
  const usable = sections.filter(
    (s) => s.body.trim() && !s.body.includes(ERROR_MARK),
  );
  if (usable.length === 0) return "";

  const blocks = usable.map((s) => {
    const lines = s.body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(renderLine);
    return `<b>${escapeHtml(s.heading)}</b>\n${lines.join("\n")}`;
  });

  const full = `<b>${escapeHtml(title)}</b>\n\n${blocks.join("\n\n")}`;
  if (full.length <= MAX_REPLY) return full;

  // Drop whole blocks rather than slicing the string: a mid-tag cut is what
  // makes Telegram reject the message, and half a calendar entry is noise.
  // The header always survives, so the message still says what it is.
  const header = `<b>${escapeHtml(title)}</b>`;
  const budget = MAX_REPLY - TAIL.length;
  let out = header;
  for (const block of blocks) {
    if (out.length + 2 + block.length > budget) break;
    out += `\n\n${block}`;
  }
  return out + TAIL;
}
