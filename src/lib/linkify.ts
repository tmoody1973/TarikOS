// Briefing cards carry their source URL inside the body text (the
// briefingCards table has no url column), so the URL has to be found at
// render time to make it openable. Pure + tested: tests/linkify.test.ts.

export type LinkPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string };

// http(s) only — a scheme allowlist, so `javascript:` can never become an href.
const URL_RE = /https?:\/\/[^\s]+/g;

// Trailing characters that belong to the sentence, not the URL. A closing
// paren only counts as sentence punctuation when it has no opener inside the
// URL, so wikipedia.org/wiki/Kolache_(pastry) survives intact.
function trimTrailing(url: string): { url: string } {
  let end = url.length;
  for (;;) {
    const ch = url[end - 1];
    if (ch === undefined) break;
    if (")]".includes(ch)) {
      const open = ch === ")" ? "(" : "[";
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(ch).length - 1;
      if (closes <= opens) break;
      end -= 1;
      continue;
    }
    if (".,;:!?\"'".includes(ch)) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: url.slice(0, end) };
}

/** Split text into ordered text and link parts, preserving every character. */
export function splitLinks(text: string): LinkPart[] {
  if (!text) return [];
  const parts: LinkPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    const { url } = trimTrailing(match[0]);

    const before = text.slice(cursor, start);
    if (before) parts.push({ type: "text", value: before });
    parts.push({ type: "link", value: url });
    // Trailing punctuation stays in the stream for the next text part.
    cursor = start + url.length;
  }

  const rest = text.slice(cursor);
  if (rest) parts.push({ type: "text", value: rest });
  return parts;
}

/** The first openable URL in the text, or null. */
export function firstLink(text: string): string | null {
  const part = splitLinks(text).find((p) => p.type === "link");
  return part ? part.value : null;
}
