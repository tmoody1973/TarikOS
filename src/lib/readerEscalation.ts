// Minimum readable text the extractor accepts. Shared with reader.ts so the
// escalation floor and the extractor's floor can never drift apart.
export const MIN_ARTICLE_CHARS = 200;

// Publishers behind Cloudflare/Akamai answer a datacenter IP with these.
const BOT_WALL_STATUSES = new Set([401, 403, 429, 451]);

/* Is it worth paying Firecrawl for this page?
 *
 * Yes when the origin blocked us (a bot wall, or a 200 carrying the empty
 * shell those walls serve) — a real browser on a real IP can get past that.
 * No when the page is genuinely gone or the origin is broken: Firecrawl can't
 * conjure a 404 into existence, and every call costs a credit. */
export function shouldEscalate({
  status,
  extractedChars,
}: {
  status: number | null;
  extractedChars: number;
}): boolean {
  if (status === null) return true; // reset/timeout — often blocking too
  if (BOT_WALL_STATUSES.has(status)) return true;
  if (status === 200) return extractedChars < MIN_ARTICLE_CHARS;
  return false;
}
