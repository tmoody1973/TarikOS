import type { MailMessage } from "./agentmailLib";

// The AgentMail API boundary. Every AgentMail URL and field name in this
// codebase lives here — the shape of src/lib/plane.ts and src/lib/googlePeople.ts,
// and for the same reason: when a provider renames something, one file changes.
//
// Server-only. The key never reaches a browser.
//
// Tarik OS holds no copy of a message. AgentMail owns them and this reads them
// live, the same call the design makes for Plane. Summaries are what land in
// Tarik OS; bodies are fetched on demand.
//
// Design: docs/superpowers/specs/2026-08-12-zola-inbox-design.md

const BASE = "https://api.agentmail.to/v0";

/**
 * Her address, in one place.
 *
 * A constant rather than an environment variable, for the reason Plane's
 * workspace slug is one: it is not a secret, it is not per-environment, and an
 * inbox that can differ between preview and production is a way to read the
 * wrong mailbox. The account also holds triton-ingest@, mke-alerts@ and
 * tarik@agentmail.to; none of those are hers.
 */
export const ZOLA_INBOX = "zola@tarikos.app";

/** An AgentMail request that failed, carrying enough to say WHY out loud. */
export class AgentMailError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`AgentMail ${status}: ${detail.slice(0, 200)}`);
    this.name = "AgentMailError";
  }
}

function token(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  // Never defaulted. A missing key that falls back to "" produces a 401, and
  // "nothing came in" is a much worse lie than "her inbox is not configured".
  if (!key) throw new Error("AGENTMAIL_API_KEY is not configured");
  return key;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      // Bearer, confirmed against the live API. X-API-Key — which is what the
      // Plane client next door uses — returns 401 here.
      Authorization: `Bearer ${token()}`,
    },
    // Always live. There is no mirror table, so a cached read IS the staleness
    // this design exists to avoid.
    cache: "no-store",
  });

  if (!res.ok) throw new AgentMailError(res.status, await res.text());
  return (await res.json()) as T;
}

type MessageList = { count: number; messages: MailMessage[] };

/**
 * What is in her inbox right now, newest first as AgentMail returns them.
 *
 * Verified against the live API: the list response is `{count, limit,
 * messages}`, and a listed message carries `preview` but NOT `text`. That is
 * why summarising leans on the preview — the body is not even there until
 * someone asks for one message by id.
 */
export async function listMessages(
  limit = 20,
  inbox = ZOLA_INBOX,
): Promise<MailMessage[]> {
  const path = `/inboxes/${encodeURIComponent(inbox)}/messages?limit=${limit}`;
  const page = await request<MessageList>(path);
  return page.messages ?? [];
}

/**
 * One message in full, fetched on demand.
 *
 * The id goes through encodeURIComponent because a message id is an address
 * with an @ in it, and an unencoded one lands on a different route.
 */
export async function getMessage(
  messageId: string,
  inbox = ZOLA_INBOX,
): Promise<MailMessage> {
  const path = `/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(messageId)}`;
  return request<MailMessage>(path);
}
