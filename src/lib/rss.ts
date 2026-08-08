import Parser from "rss-parser";
import type { ResearchResult } from "./research";
import { safeSlice } from "../../convex/workflowLib.ts";

// RSS ingestion for the morning brief: fetch a group of feeds, keep recent
// items, return them in the same shape as research results so the brief
// formatter treats them identically (linked headlines, clean snippets).

// ponytail: 36h window — covers overnight + slow publishers; Monday briefs
// miss the weekend tail, widen if that stings.
const RECENT_MS = 36 * 60 * 60 * 1000;
const PER_GROUP_CAP = 6;

export type FeedItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
};

export function itemsToResults(
  items: FeedItem[],
  now: number = Date.now(),
): ResearchResult[] {
  return items
    .map((item) => ({
      item,
      at: Date.parse(item.isoDate ?? item.pubDate ?? "") || 0,
    }))
    .filter(({ item, at }) => item.title && item.link && now - at < RECENT_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, PER_GROUP_CAP)
    .map(({ item }) => ({
      title: item.title!,
      url: item.link!,
      snippet: safeSlice(item.contentSnippet ?? "", 220),
    }));
}

export type FeedStatus = { url: string; ok: boolean; error?: string };

export async function fetchFeedGroup(
  feedUrls: string[],
): Promise<{ results: ResearchResult[]; statuses: FeedStatus[] }> {
  const parser = new Parser({ timeout: 10_000 });
  const settled = await Promise.allSettled(
    feedUrls.map((u) => parser.parseURL(u)),
  );
  const statuses = settled.map((s, i) =>
    s.status === "fulfilled"
      ? { url: feedUrls[i], ok: true }
      : { url: feedUrls[i], ok: false, error: safeSlice(String(s.reason), 140) },
  );
  const items = settled
    .filter(
      (s): s is PromiseFulfilledResult<{ items: FeedItem[] }> =>
        s.status === "fulfilled",
    )
    .flatMap((s) => s.value.items ?? []);
  if (statuses.length > 0 && statuses.every((s) => !s.ok)) {
    throw new Error("All feeds in this group failed to load.");
  }
  return { results: itemsToResults(items), statuses };
}
