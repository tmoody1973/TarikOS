// Display label for a URL: bare hostname without www. Shared by the feed
// chips and the browse-brief sources.
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
