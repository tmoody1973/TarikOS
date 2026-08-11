// Contact identity: what makes two provider records the same person.
//
// Lives in convex/ for the same reason documentsLib and telegramLib do —
// Convex actions cannot import from src/, and the sync that writes contacts
// runs inside Convex while the find_contact tool route runs in Next. Pure and
// dependency-free so the matching rules can be tested directly.
//
// Phone normalization carries two jobs at once, which is why it is strict:
// it decides whether two records MERGE, and it produces the exact string
// handed to Telnyx to dial. A number that normalizes two ways leaves a
// duplicate contact; one that normalizes wrongly places a call to a stranger.
// When a value cannot be resolved with confidence the answer is null — a
// contact with one fewer phone number is recoverable, a wrong one is not.

/** Default region. Tarik is in Milwaukee; providers rarely qualify US numbers. */
const US_COUNTRY_CODE = "1";

/** E.164 allows at most 15 digits after the +, and no real number is under 7. */
const E164_MAX_DIGITS = 15;
const E164_MIN_DIGITS = 7;

/** Where an extension starts. Everything from here on is not dialable. */
const EXTENSION = /(?:\s*(?:x|ext\.?|extension)\s*\d+|;.*)$/i;

/**
 * A phone number as E.164 (`+14145551234`), or null if it is not one.
 *
 * Letters are a rejection rather than something to strip: "414-555-CALL" has
 * the shape of a number, and removing the letters yields a shorter string that
 * would normalize into a real, different, dialable number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(EXTENSION, "");
  if (!trimmed) return null;

  // Anything that is not punctuation, a digit or a leading + means this is not
  // a phone number we can be sure about.
  if (/[^\d\s()+.\-]/.test(trimmed)) return null;

  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (plus) {
    return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS
      ? `+${digits}`
      : null;
  }

  // 011 is a US exit code, not part of the number the world calls.
  if (digits.startsWith("011") && digits.length > 11) {
    digits = digits.slice(3);
    return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS
      ? `+${digits}`
      : null;
  }

  if (digits.length === 11 && digits.startsWith(US_COUNTRY_CODE)) {
    digits = digits.slice(1);
  }

  // Exactly ten digits, and NANP area and exchange codes never start with 0
  // or 1. This is also what rejects the other lengths: 7 digits has no area
  // code and cannot be dialled, and 11 digits not starting with 1 would need a
  // guessed country code — guessing is how a contact ends up with a number
  // that reaches someone else.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+${US_COUNTRY_CODE}${digits}`;
}

/**
 * An email lowercased and trimmed, or null if it is not an address.
 *
 * Dots in the local part are deliberately preserved. Gmail treats them as
 * insignificant and almost nothing else does, so stripping them would merge
 * two different people at every other domain.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toLowerCase();
  // Deliberately not RFC 5322 — this only has to reject junk that providers
  // put in email fields ("", "none", a bare name), not validate deliverability.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(clean) ? clean : null;
}

export type ContactIdentity = {
  phones?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
};

/**
 * The keys two records must share to be the same person.
 *
 * Namespaced so a contact whose email is a string of digits can never match
 * another contact's phone number. A record whose values are all unusable
 * yields NO keys, which is the point: keyless records must never match each
 * other, or every contact missing a phone and email merges into one blob.
 */
export function identityKeys(contact: ContactIdentity): string[] {
  const keys = [
    ...(contact.phones ?? []).map(normalizePhone).filter(Boolean).map((p) => `tel:${p}`),
    ...(contact.emails ?? []).map(normalizeEmail).filter(Boolean).map((e) => `email:${e}`),
  ];
  return [...new Set(keys)];
}

// ------------------------------------------------------------------ merging

export type SourceContact = {
  source: "google" | "icloud";
  sourceId: string;
  name: string;
  phones: (string | null | undefined)[];
  emails: (string | null | undefined)[];
  org?: string;
  photo?: string;
};

export type MergedContact = {
  name: string;
  phones: string[];
  emails: string[];
  org?: string;
  photo?: string;
  sources: { source: "google" | "icloud"; sourceId: string }[];
};

/** Words in a name, lowercased, punctuation and ordering discarded. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether two names can belong to the same person.
 *
 * A shared phone or email is necessary to merge but NOT sufficient: two people
 * on one household landline share an identity key while being different
 * people, and merging them produces a contact that answers "call my mom" with
 * the wrong name on it. So one name's words must be a subset of the other's —
 * "Sarah" matches "Sarah Chen", "Rita Moody" does not match "Gerald Moody".
 *
 * Ordering is discarded so "Chen, Sarah" matches "Sarah Chen". An absent name
 * never blocks a merge, because a provider record with only a number is
 * exactly the record that most needs to attach to a named one.
 */
export function compatibleNames(a: string, b: string): boolean {
  const left = new Set(nameTokens(a ?? ""));
  const right = new Set(nameTokens(b ?? ""));
  if (left.size === 0 || right.size === 0) return true;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  return [...small].every((token) => large.has(token));
}

/**
 * Collapse provider records into one record per person.
 *
 * Union by shared identity key, transitively — Google may hold the email and
 * iCloud the phone, with a third record bridging them. Records carrying no
 * usable phone or email have no keys and therefore never merge with anything,
 * which is deliberate: without it every name-only contact in the book would
 * collapse into a single record.
 *
 * Input order does not affect the result beyond ordering it, so a sync that
 * receives contacts in a different order does not rewrite every row.
 */
export function mergeContacts(records: SourceContact[]): MergedContact[] {
  const parent = records.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };

  // First record seen for each key; later ones union against it, so the
  // relation stays transitive without comparing every pair.
  const seen = new Map<string, number[]>();
  records.forEach((record, i) => {
    for (const key of identityKeys(record)) {
      const holders = seen.get(key) ?? [];
      for (const j of holders) {
        if (compatibleNames(record.name, records[j].name)) union(i, j);
      }
      holders.push(i);
      seen.set(key, holders);
    }
  });

  const groups = new Map<number, number[]>();
  records.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  return [...groups.entries()]
    .sort((a, z) => a[0] - z[0])
    .map(([, members]) => {
      const parts = members.map((i) => records[i]);
      const sources = new Map<string, { source: "google" | "icloud"; sourceId: string }>();
      for (const p of parts) {
        sources.set(`${p.source}:${p.sourceId}`, { source: p.source, sourceId: p.sourceId });
      }
      return {
        // The fullest name wins — a record holding only "Sarah" must not
        // overwrite the one that knows she is Sarah Chen.
        name: parts.map((p) => p.name ?? "").sort((a, z) => z.length - a.length)[0] ?? "",
        phones: [...new Set(parts.flatMap((p) => p.phones.map(normalizePhone).filter(Boolean)))] as string[],
        emails: [...new Set(parts.flatMap((p) => p.emails.map(normalizeEmail).filter(Boolean)))] as string[],
        org: parts.find((p) => p.org)?.org,
        photo: parts.find((p) => p.photo)?.photo,
        sources: [...sources.values()],
      };
    });
}
