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
 * A trailing "(IDP)" / "(mobile)" style label.
 *
 * Kept because the real address book has them: of 615 phone strings in Tarik's
 * contacts, one of the seven rejects was a valid ten-digit number carrying
 * "(IDP)". Anchored to the END, which is what keeps the leading "(414)" of an
 * area code safe — the letter requirement is a second, weaker filter and does
 * not carry that job on its own.
 */
const TRAILING_LABEL = /\s*\([^)]*\p{L}[^)]*\)\s*$/u;

/**
 * A phone number as E.164 (`+14145551234`), or null if it is not one.
 *
 * Letters are a rejection rather than something to strip: "414-555-CALL" has
 * the shape of a number, and removing the letters yields a shorter string that
 * would normalize into a real, different, dialable number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(TRAILING_LABEL, "").replace(EXTENSION, "");
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

// ------------------------------------------------------- google people rows

type PeopleRow = {
  resourceName?: string;
  metadata?: { deleted?: boolean };
  names?: { displayName?: string; unstructuredName?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
  photos?: { url?: string }[];
};

/**
 * Google People API rows → SourceContact.
 *
 * Shapes here came from a real response over Tarik's 4,934 contacts rather
 * than the API reference, and the sample is why this is permissive: 85 of 100
 * rows had no email, 34 had no phone, and 2 had no name at all. Sparse is the
 * normal case, so a row missing almost everything is still a contact.
 *
 * `canonicalForm` is Google's own E.164 and parses international numbers
 * better than normalizePhone does, so it wins where Google produced one.
 * Both paths still run through normalizePhone downstream, which is what keeps
 * dedupe consistent regardless of which source the string came from.
 */
export function googlePeopleToContacts(rows: PeopleRow[] | undefined): SourceContact[] {
  return (rows ?? []).flatMap((row) => {
    // No resourceName means no stable identity, so a re-sync could not tell an
    // edit from a new contact and would duplicate the row every run.
    if (!row?.resourceName) return [];
    // Incremental syncs return tombstones for removed people; taken as
    // contacts they would overwrite the real row with empty fields.
    if (row.metadata?.deleted) return [];

    const name = row.names?.find((n) => n.displayName || n.unstructuredName);
    const org = row.organizations?.find((o) => o.name);
    return [
      {
        source: "google" as const,
        sourceId: row.resourceName,
        name: (name?.displayName ?? name?.unstructuredName ?? "").trim(),
        phones: (row.phoneNumbers ?? [])
          .map((p) => (p.canonicalForm || p.value || "").trim())
          .filter(Boolean),
        emails: (row.emailAddresses ?? []).map((e) => (e.value || "").trim()).filter(Boolean),
        org: org?.name,
        photo: row.photos?.find((p) => p.url)?.url,
      },
    ];
  });
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

// ---------------------------------------------------------------- searching

export type SearchableContact = {
  name: string;
  phones: string[];
  emails: string[];
  org?: string;
};

/** Comparable form: lowercase, punctuation gone, spacing collapsed. */
function searchable(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score one contact against a spoken query. 0 means no match.
 *
 * Weighted so the strongest evidence wins outright: an identifier the caller
 * read out (a number, an address) is unambiguous, a whole-name match is next,
 * and an org match is a weak last resort so "Radio Milwaukee" still finds the
 * front desk without burying a person of that name.
 */
function scoreContact(contact: SearchableContact, query: string): number {
  const q = searchable(query);
  if (!q) return 0;

  // An identifier read aloud is exact evidence — match it in normalized form
  // so "414-555-1234" finds the contact stored as "+14145551234".
  const asPhone = normalizePhone(query);
  if (asPhone && contact.phones.includes(asPhone)) return 100;
  const asEmail = normalizeEmail(query);
  if (asEmail && contact.emails.includes(asEmail)) return 100;

  const name = searchable(contact.name);
  let score = 0;
  {
    // No guard on an empty name: it scores 0 through these branches anyway,
    // and a guard a mutation cannot kill is a guard that is not doing work.
    if (name === q) score = 60;
    else if (name.startsWith(q)) score = 45;
    else {
      const words = name.split(" ");
      const terms = q.split(" ");
      // Every spoken word has to land somewhere in the name, or "Sarah Chen"
      // would match "Sarah Okonkwo" on one word out of two.
      // terms.length is a property of the QUERY, so it is identical for every
      // contact in one call and cannot change an ordering. One constant.
      const all = terms.every((t) => words.some((w) => w.startsWith(t)));
      if (all) score = 30;
    }
  }

  // Weak, and only when the name did not match at all.
  if (!score && contact.org && searchable(contact.org).includes(q)) score = 10;
  if (!score) return 0;

  // A contact with no phone and no email cannot be called or texted, and
  // 4,033 of the real book are exactly that. Reachable wins the tie.
  return score + (contact.phones.length || contact.emails.length ? 1 : 0);
}

/**
 * The contacts worth offering for a spoken name, best first.
 *
 * Non-matches are excluded rather than ranked low: handing Zola a list padded
 * with weak matches invites her to guess, and every ambiguous name must come
 * back in full so she can ask which one he meant. Ties break on name so a
 * spoken "the first one" means the same thing twice.
 */
export function rankContacts<T extends SearchableContact>(
  contacts: T[],
  query: string,
  limit: number,
): T[] {
  return contacts
    .map((contact) => ({ contact, score: scoreContact(contact, query) }))
    .filter((r) => r.score > 0)
    .sort((a, z) => z.score - a.score || a.contact.name.localeCompare(z.contact.name))
    .slice(0, limit)
    .map((r) => r.contact);
}

/**
 * The value an upsert matches on, so a re-sync updates a person rather than
 * duplicating them.
 *
 * Provider id, NOT a phone or email. Keying on the first identity value looks
 * tidier and is wrong: two people sharing a household landline are correctly
 * kept apart as contacts by compatibleNames, and then collapse right back
 * together at the key. Running the real book proved it — 4,825 merged contacts
 * wrote 4,823 rows, and the two lost people were exactly that case.
 *
 * A provider id belongs to one person by construction, so every merged record
 * gets a distinct key, and a provider reformatting a number leaves it
 * untouched. Sources are sorted so a merge group spanning two providers picks
 * the same id every run rather than depending on arrival order.
 */
export function contactKey(contact: MergedContact): string {
  const ids = contact.sources
    .map((s) => `${s.source}:${s.sourceId}`)
    .sort();
  return ids[0] ? `src:${ids[0]}` : "";
}

// ----------------------------------------------------------------- writing

export type NewContact = {
  name: string;
  phone?: string;
  email?: string;
  org?: string;
};

export type PersonPayload = {
  names: { givenName: string; familyName?: string }[];
  phoneNumbers?: { value: string }[];
  emailAddresses?: { value: string }[];
  organizations?: { name: string }[];
};

/**
 * A Google People createContact body, or a refusal with the reason.
 *
 * Refuses far more than it accepts, because this writes into a real address
 * book from a spoken instruction relayed through a transcript. A wrong number
 * saved under a right name is worse than no contact at all: it looks correct,
 * it will be dialled, and nothing downstream will ever flag it — the sync only
 * reads, so it will faithfully carry the mistake back every day.
 *
 * The number is normalized with the same function dedupe uses, so what gets
 * written is what a later read would have matched on.
 */
export function buildPersonPayload(
  input: NewContact,
): { ok: boolean; person?: PersonPayload; error?: string } {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "I need a name for the contact." };

  if (!input.phone && !input.email) {
    return {
      ok: false,
      error: "I need a number or an email — a name on its own can't be called or written to.",
    };
  }

  let phoneNumbers: { value: string }[] | undefined;
  if (input.phone) {
    const normalized = normalizePhone(input.phone);
    if (!normalized) {
      return { ok: false, error: `${input.phone} isn't a number I can dial. Say it again?` };
    }
    phoneNumbers = [{ value: normalized }];
  }

  let emailAddresses: { value: string }[] | undefined;
  if (input.email) {
    const normalized = normalizeEmail(input.email);
    if (!normalized) {
      return { ok: false, error: `${input.email} isn't an email address I can use.` };
    }
    emailAddresses = [{ value: normalized }];
  }

  return {
    ok: true,
    person: {
      names: splitName(name),
      ...(phoneNumbers ? { phoneNumbers } : {}),
      ...(emailAddresses ? { emailAddresses } : {}),
      ...(input.org?.trim() ? { organizations: [{ name: input.org.trim() }] } : {}),
    },
  };
}

/**
 * A spoken name as Google's given/family pair.
 *
 * Everything after the first word is the family name: "Sarah A Chen" keeps its
 * middle initial rather than losing it to a three-way split.
 */
function splitName(name: string): { givenName: string; familyName?: string }[] {
  const [givenName, ...rest] = name.split(" ");
  return [rest.length ? { givenName, familyName: rest.join(" ") } : { givenName }];
}

// ----------------------------------------------------------------- editing

/** The subset of a Google person this can change. Absent means "leave it". */
export type ContactChanges = {
  name?: string;
  phone?: string;
  email?: string;
  org?: string;
};

/** What Google returned for a contact — only the fields we ever touch. */
export type CurrentPerson = {
  names?: { givenName?: string; familyName?: string }[];
  phoneNumbers?: { value?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string }[];
};

/** One field this update overwrites, and what was standing there. */
export type Replacement = { field: string; from: string[]; to: string };

export type UpdatePayload = {
  ok: boolean;
  person?: Partial<PersonPayload>;
  /** Google's field mask. ONLY the fields named here are touched. */
  updatePersonFields?: string;
  replaced?: Replacement[];
  error?: string;
};

function currentName(person: CurrentPerson): string {
  const n = person.names?.[0];
  return [n?.givenName, n?.familyName].filter(Boolean).join(" ");
}

function values(list: { value?: string }[] | undefined): string[] {
  return (list ?? []).map((v) => v.value ?? "").filter(Boolean);
}

/**
 * A Google People updateContact body and its field mask, or a refusal.
 *
 * Stricter than the create path, because an edit can destroy something that
 * was right. Two rules carry that:
 *
 * Every accepted change reports what it DISPLACED. Google's updateContact
 * replaces a named field entirely — there is no "change the second number" —
 * so a person with a mobile and a work line loses one the moment a new number
 * is written, and this is the only place that fact is still visible.
 *
 * A change that changes nothing is refused rather than sent. Not because a
 * no-op write is dangerous, but because "his number is already that" is the
 * true answer and a cheerful "updated" hides it.
 *
 * ponytail: replaces the whole field. Per-value editing ("change his WORK
 * number") when the book has people whose second number actually matters.
 */
export function buildUpdatePayload(
  current: CurrentPerson,
  changes: ContactChanges,
): UpdatePayload {
  const person: Partial<PersonPayload> = {};
  const fields: string[] = [];
  const replaced: Replacement[] = [];
  // Distinct from "nothing changed": one means he asked for nothing, the other
  // means what he asked for is already true.
  let asked = false;

  if (changes.name !== undefined) {
    asked = true;
    const name = changes.name.trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: "I need a name to change it to." };
    const was = currentName(current);
    if (name !== was) {
      person.names = splitName(name);
      fields.push("names");
      replaced.push({ field: "name", from: was ? [was] : [], to: name });
    }
  }

  if (changes.phone !== undefined) {
    asked = true;
    const normalized = normalizePhone(changes.phone);
    if (!normalized) {
      return { ok: false, error: `${changes.phone} isn't a number I can dial. Say it again?` };
    }
    const was = values(current.phoneNumbers);
    if (!(was.length === 1 && was[0] === normalized)) {
      person.phoneNumbers = [{ value: normalized }];
      fields.push("phoneNumbers");
      replaced.push({ field: "phone", from: was, to: normalized });
    }
  }

  if (changes.email !== undefined) {
    asked = true;
    const normalized = normalizeEmail(changes.email);
    if (!normalized) {
      return { ok: false, error: `${changes.email} isn't an email address I can use.` };
    }
    const was = values(current.emailAddresses);
    if (!(was.length === 1 && was[0] === normalized)) {
      person.emailAddresses = [{ value: normalized }];
      fields.push("emailAddresses");
      replaced.push({ field: "email", from: was, to: normalized });
    }
  }

  if (changes.org !== undefined) {
    asked = true;
    const org = changes.org.trim();
    if (!org) return { ok: false, error: "I need a workplace to change it to." };
    const was = (current.organizations ?? []).map((o) => o.name ?? "").filter(Boolean);
    if (!(was.length === 1 && was[0] === org)) {
      person.organizations = [{ name: org }];
      fields.push("organizations");
      replaced.push({ field: "org", from: was, to: org });
    }
  }

  if (!asked) {
    return { ok: false, error: "What should I change about them?" };
  }
  if (fields.length === 0) {
    return { ok: false, error: "That's already what I have saved for them." };
  }

  return { ok: true, person, updatePersonFields: fields.join(","), replaced };
}
