// Reading the address book from Google People (MOO-499).
//
// Through the EXISTING Gmail connection. That grant already carries
// contacts.readonly and contacts.other.readonly — Composio's own
// googlecontacts toolkit reports no managed auth schemes, so routing through
// it would mean standing up a bring-your-own Google OAuth app for access this
// connection already has.
//
// Composio's proxy makes the call with credentials it already holds, so no
// token is ever handled here. It needs an API key with `proxy_execute` write,
// which is why this reads COMPOSIO_PROXY_API_KEY rather than the key the rest
// of the Composio code uses.

import { connectedAccounts } from "./google.ts";

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,photos,metadata";

/** Google's maximum for this endpoint. */
const PAGE_SIZE = 1000;

/**
 * Hard stop on paging.
 *
 * 4,934 contacts is five pages today. Ten is headroom without letting a
 * malformed nextPageToken loop forever — the rss-parser lesson: never let an
 * external response decide how long we keep going.
 */
const MAX_PAGES = 25;

const REQUEST_TIMEOUT_MS = 30_000;

export type PeopleRow = Record<string, unknown>;

function proxyKey(): string {
  const key = process.env.COMPOSIO_PROXY_API_KEY;
  if (!key) {
    throw new Error(
      "COMPOSIO_PROXY_API_KEY is not set — contact sync needs a Composio key with proxy_execute write access",
    );
  }
  return key;
}

/**
 * One proxied call, with our own abort rather than the SDK's.
 *
 * Called directly rather than through @composio/core so the timeout is ours:
 * a library's own timeout option has silently failed to abort a stalled
 * request on this project before (rss-parser, which hung for minutes).
 */
async function proxy(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  connectedAccountId: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const abort = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch("https://backend.composio.dev/api/v3.1/tools/execute/proxy", {
    method: "POST",
    headers: { "x-api-key": proxyKey(), "content-type": "application/json" },
    body: JSON.stringify({
      endpoint,
      method,
      connected_account_id: connectedAccountId,
      ...(body === undefined ? {} : { body }),
    }),
    signal: abort,
  });
  if (!res.ok) {
    throw new Error(`Composio proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const payload = (await res.json()) as { data?: Record<string, unknown> };
  return payload.data ?? (payload as Record<string, unknown>);
}

const proxyGet = (endpoint: string, connectedAccountId: string) =>
  proxy("GET", endpoint, connectedAccountId);

/**
 * Every contact on the connected Google account.
 *
 * A full pull each time rather than an incremental syncToken pass. The
 * observable requirement — edit a contact, see it next sync — is met either
 * way, and a full pull cannot drift: an incremental one has to apply
 * tombstones correctly forever or the store silently diverges from Google.
 * At five pages a day the saving would not pay for that risk yet.
 */
export async function fetchGooglePeople(): Promise<PeopleRow[]> {
  const [account] = await connectedAccounts("gmail");
  const rows: PeopleRow[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url =
      `https://people.googleapis.com/v1/people/me/connections` +
      `?personFields=${PERSON_FIELDS}&pageSize=${PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = await proxyGet(url, account.id);
    rows.push(...((data.connections as PeopleRow[]) ?? []));
    pageToken = data.nextPageToken as string | undefined;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return rows;
}

/**
 * The connection that may WRITE contacts.
 *
 * Separate from the read path on purpose. Reads ride the Gmail connection,
 * whose grant happens to include contacts.readonly. Writing needs
 * .../auth/contacts, which only the dedicated googlecontacts connection has —
 * and that one required its own Google Cloud OAuth app.
 */
function writeAccountId(): string {
  const id = process.env.GOOGLE_CONTACTS_ACCOUNT_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_CONTACTS_ACCOUNT_ID is not set — adding contacts needs the googlecontacts connection",
    );
  }
  return id;
}

/**
 * Create one contact in Google, returning the row Google stored.
 *
 * The response is fed straight back through the same mapper the sync uses, so
 * what gets stored locally is exactly what tomorrow's sync would have read —
 * there is no second shape to keep in step.
 */
export async function createGoogleContact(person: unknown): Promise<PeopleRow> {
  const row = await proxy(
    "POST",
    "https://people.googleapis.com/v1/people:createContact",
    writeAccountId(),
    person,
  );
  if (!row?.resourceName) {
    throw new Error("Google accepted the write but returned no contact");
  }
  return row;
}

/**
 * A resource name is a path segment, so it is checked rather than trusted.
 *
 * It reaches here from a Convex row that a provider wrote, and it is
 * concatenated into a URL. `people/c123` and nothing else.
 */
function resourcePath(resourceName: string): string {
  if (!/^people\/[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new Error(`Not a Google contact id: ${resourceName.slice(0, 40)}`);
  }
  return resourceName;
}

/**
 * Read one contact fresh from Google, through the WRITE connection.
 *
 * Two reasons it is not the sync's read path. Google's updateContact demands
 * the `etag` of the version being replaced — that is its whole concurrency
 * story, and a stale one is rejected rather than silently clobbering — so it
 * has to come from a read taken moments before the write. And an etag is only
 * meaningful against the grant that will do the writing.
 */
export async function getGoogleContact(resourceName: string): Promise<PeopleRow> {
  const path = resourcePath(resourceName);
  const row = await proxy(
    "GET",
    `https://people.googleapis.com/v1/${path}?personFields=${PERSON_FIELDS}`,
    writeAccountId(),
  );
  if (!row?.etag) {
    throw new Error("Google returned a contact with no etag, so it cannot be changed safely");
  }
  return row;
}

/**
 * Overwrite the named fields of one contact.
 *
 * `updatePersonFields` is a replace mask: a field named there is replaced by
 * what this body carries, and a field NOT named is untouched. Never widen it
 * to cover a field the caller did not ask for — an omitted value under a named
 * field clears it.
 */
export async function updateGoogleContact(
  resourceName: string,
  etag: string,
  person: unknown,
  updatePersonFields: string,
): Promise<PeopleRow> {
  const path = resourcePath(resourceName);
  const mask = encodeURIComponent(updatePersonFields);
  const row = await proxy(
    "PATCH",
    `https://people.googleapis.com/v1/${path}:updateContact?updatePersonFields=${mask}&personFields=${PERSON_FIELDS}`,
    writeAccountId(),
    { ...(person as Record<string, unknown>), etag },
  );
  if (!row?.resourceName) {
    throw new Error("Google accepted the change but returned no contact");
  }
  return row;
}

/** Remove one contact from Google. Nothing brings it back. */
export async function deleteGoogleContact(resourceName: string): Promise<void> {
  const path = resourcePath(resourceName);
  await proxy(
    "DELETE",
    `https://people.googleapis.com/v1/${path}:deleteContact`,
    writeAccountId(),
  );
}
