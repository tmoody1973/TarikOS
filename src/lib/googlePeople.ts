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
 * One proxied GET, with our own abort rather than the SDK's.
 *
 * Called directly rather than through @composio/core so the timeout is ours:
 * a library's own timeout option has silently failed to abort a stalled
 * request on this project before (rss-parser, which hung for minutes).
 */
async function proxyGet(endpoint: string, connectedAccountId: string): Promise<Record<string, unknown>> {
  const abort = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch("https://backend.composio.dev/api/v3.1/tools/execute/proxy", {
    method: "POST",
    headers: { "x-api-key": proxyKey(), "content-type": "application/json" },
    body: JSON.stringify({ endpoint, method: "GET", connected_account_id: connectedAccountId }),
    signal: abort,
  });
  if (!res.ok) {
    throw new Error(`Composio proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { data?: Record<string, unknown> };
  return body.data ?? (body as Record<string, unknown>);
}

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
