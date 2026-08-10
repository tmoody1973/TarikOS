// What a saved document actually contains, as pure functions.
//
// v1 stores what the source already produces — markdown for briefs and
// journal digests, markdown for research results. No PDF, no rendering
// pipeline: that's a library decision and a bigger feature, deferred until
// there's a concrete request for it.
//
// Kept free of R2 and Convex so the file's contents, its name and its place
// in the bucket can be tested directly, the way documentsLib's rules are.

export type BuiltDocument = {
  title: string;
  filename: string;
  contentType: string;
  body: string;
};

/** Chicago-agnostic: the date in the filename is UTC, like every objectKey. */
function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Lowercase, hyphenated, ASCII. Anything else becomes a hyphen, runs collapse,
 * and the result can't be empty — an empty segment would make a key like
 * `documents/2026-08-10--.md`, or worse, one that ends in a slash.
 */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "document";
}

/**
 * Where the bytes live in the bucket.
 *
 * The title reaches here from something Zola heard out loud, so it is
 * untrusted. `..` and `/` in an S3 key aren't filesystem traversal, but they
 * do let one document shadow or collide with another — slugify removes both
 * by construction, since anything outside `[a-z0-9]` becomes a hyphen.
 *
 * The random suffix is not decoration: two saves of the same brief on the
 * same day would otherwise write the same key, and the second would silently
 * replace the first.
 */
export function objectKeyFor(
  title: string,
  extension: string,
  now: number,
): string {
  const suffix = Math.floor(
    globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
  ).toString(36);
  return `documents/${isoDate(now)}-${slugify(title)}-${suffix}.${extension}`;
}

function markdown(title: string, body: string, now: number): BuiltDocument {
  return {
    title,
    filename: `${isoDate(now)}-${slugify(title)}.md`,
    contentType: "text/markdown",
    body,
  };
}

export type BriefSource = {
  title: string;
  sections: { heading: string; body: string }[];
};

export function buildDocumentFromBrief(
  brief: BriefSource,
  now: number,
): BuiltDocument {
  const sections = brief.sections
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join("\n\n");
  // A brief with no sections still gets a file. An empty one is worse than a
  // stub: it looks like the save failed.
  const body =
    `# ${brief.title}\n\n_Saved ${isoDate(now)}._\n\n` +
    (sections || "_This brief had no sections when it was saved._\n");
  return markdown(brief.title, body, now);
}

export type ResearchSource = { title: string; url: string; snippet: string };

export function buildDocumentFromResearch(
  query: string,
  results: ResearchSource[],
  now: number,
): BuiltDocument {
  const title = `Research — ${query}`;
  // The URL is the reason to keep a research result at all; the snippet
  // without its source is a rumour.
  const items = results
    .map((r) => `### ${r.title}\n\n${r.url}\n\n${r.snippet}`)
    .join("\n\n");
  const body =
    `# ${title}\n\n_Saved ${isoDate(now)}._\n\n` +
    (items || "_No results were returned for this query._\n");
  return markdown(title, body, now);
}

export function buildDocumentFromJournal(
  digest: string,
  now: number,
): BuiltDocument {
  const title = `Journal digest — ${isoDate(now)}`;
  // The digest arrives already rendered by buildJournalDigest. Re-rendering
  // it would mean two formatters to keep in step.
  return markdown(title, `# ${title}\n\n${digest}\n`, now);
}

/** Never forever by default (design doc, "Default expiry"). */
export const DEFAULT_SHARE_DAYS = 7;

/** A year. Past this, the honest request is "never", said out loud. */
const MAX_SHARE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a share link dies.
 *
 * `undefined` means the caller said nothing, which is the default window, not
 * forever. Only the literal word "never" buys an unexpiring link — a spoken
 * decision, per the design. Zero and negatives are mis-heard numbers rather
 * than a request to publish permanently, so they fall back to the default
 * instead of producing a link that is already dead or never dies.
 */
export function shareExpiryFrom(
  days: number | string | undefined,
  now: number,
): number | undefined {
  if (typeof days === "string") {
    return days.trim().toLowerCase() === "never"
      ? undefined
      : now + DEFAULT_SHARE_DAYS * DAY_MS;
  }
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return now + DEFAULT_SHARE_DAYS * DAY_MS;
  }
  return now + Math.min(days, MAX_SHARE_DAYS) * DAY_MS;
}
