// Header text for the reader pane. Escalated pages come back without a <head>,
// so Readability's title and byline arrive dirty or empty — these clean both
// without inventing anything.

const SEPARATORS = [" | ", " - ", " – ", " — ", " :: ", " · "];

// "Food Network" and "www.foodnetwork.com" are the same site to a reader.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Drop a trailing site name: "Recipes | Food Network" → "Recipes". */
export function cleanTitle(
  title: string,
  { siteName, hostname }: { siteName: string | null; hostname: string },
): string {
  const trimmed = title.trim();
  const host = normalize(hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, ""));
  const site = siteName ? normalize(siteName) : "";

  for (const sep of SEPARATORS) {
    const at = trimmed.lastIndexOf(sep);
    if (at <= 0) continue;
    const head = trimmed.slice(0, at).trim();
    const tail = normalize(trimmed.slice(at + sep.length));
    if (!head || !tail) continue;
    // The tail is the site when it matches the reported name, or when the
    // hostname contains it (foodnetwork ⊂ foodnetwork).
    if (tail === site || (tail.length > 2 && host.includes(tail))) return head;
  }
  return trimmed;
}

/** A byline that is only a label ("By:") is not a byline. */
export function cleanByline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // \b so "Byron" keeps his name; [:\s]* so a bare "by" still reduces to empty.
  const stripped = raw.trim().replace(/^by\b[:\s]*/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}
