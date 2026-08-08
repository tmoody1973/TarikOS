import Parser from "rss-parser";
import { parseHTML } from "linkedom";

// Feed autodiscovery (MOO-486): site URL → validated RSS/Atom feed URL.
// Strategy: <link rel="alternate"> tags first, /feed-style path probing as
// fallback, and every candidate must parse as a real feed before we return
// it — junk never gets saved.

export function normalizeSiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

const FEED_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/feed+json",
]);

export function extractFeedLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll('link[rel="alternate"]')];
  return links
    .filter((l) => FEED_TYPES.has((l.getAttribute("type") ?? "").toLowerCase()))
    .map((l) => {
      try {
        return new URL(l.getAttribute("href") ?? "", baseUrl).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

// ponytail: the common conventions; exotic feed paths lose to a clean "no
// feed found" rather than an ever-longer probe list.
const PROBE_PATHS = ["feed", "rss", "feed.xml", "rss.xml", "atom.xml", "index.xml"];

export function feedCandidatePaths(siteUrl: string): string[] {
  const origin = new URL(siteUrl).origin;
  return PROBE_PATHS.map((p) => `${origin}/${p}`);
}

export type DiscoveredFeed = { feedUrl: string; title: string };

// Fetch ourselves with an abortable timeout, then parseString — rss-parser's
// own `timeout` option does not reliably abort stalled requests (measured
// live: parseURL hung minutes past its 10s setting).
async function validateFeed(url: string): Promise<DiscoveredFeed | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (TarikOS feed discovery)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const feed = await new Parser().parseString(await res.text());
    return { feedUrl: url, title: feed.title?.trim() || url };
  } catch {
    return null;
  }
}

// Full discovery: one deduped candidate list (the input itself, the page's
// link tags, the conventional probe paths), validated IN PARALLEL with the
// first success in priority order winning — worst case is ~one timeout, not
// a serial sum, which keeps the voice webhook inside its budget.
// Returns null when nothing validates; never throws for feedless sites.
export async function discoverFeed(input: string): Promise<DiscoveredFeed | null> {
  const siteUrl = normalizeSiteUrl(input);
  if (!siteUrl) return null;

  let linkCandidates: string[] = [];
  try {
    const res = await fetch(siteUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (TarikOS feed discovery)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      linkCandidates = extractFeedLinks(await res.text(), res.url || siteUrl);
    }
  } catch {
    // Page fetch failing doesn't end discovery — probe paths may still hit.
  }

  const candidates = [
    ...new Set([siteUrl, ...linkCandidates, ...feedCandidatePaths(siteUrl)]),
  ];
  const validated = await Promise.all(candidates.map(validateFeed));
  return validated.find(Boolean) ?? null;
}
