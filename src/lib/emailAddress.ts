// Client-safe (no server imports): parse a "Name <email>" From header down
// to the address. Shared by the /mail UI and the mail lib.
export function extractEmailAddress(from: string): string | undefined {
  return from.match(/<([^>]+)>/)?.[1] ?? (from.trim() || undefined);
}
