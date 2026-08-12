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

/**
 * Email to exactly one person: Tarik.
 *
 * This is NOT a send path for Zola, and the difference is the whole design.
 * "Zola drafts; only a human sends" governs CORRESPONDENCE — mail that goes to
 * other people, as him. A reminder is a notification to himself, built in the
 * shape `call_tarik` established: the recipient is not a parameter of
 * anything, it comes from OWNER_EMAIL on the server, so there is no argument
 * to pass and nothing to talk her into.
 *
 * It never touches Gmail. The Gmail guardrail stays literally intact: there is
 * still no send path in the tool route, and this could not become one without
 * someone adding a recipient argument that does not exist.
 *
 * It reports its failures rather than throwing, unlike the reads above,
 * because the caller is a scheduled reminder: an unconfigured channel that
 * reports success is a reminder he never gets and never learns he never got.
 */
export async function emailOwner(
  subject: string,
  body: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.AGENTMAIL_API_KEY?.trim();
  const owner = process.env.OWNER_EMAIL?.trim();
  if (!key) return { ok: false, reason: "AGENTMAIL_API_KEY is not set" };
  if (!owner) return { ok: false, reason: "OWNER_EMAIL is not set" };

  // POST /inboxes/{inbox}/messages/send, confirmed against the live API: `to`
  // is the only required field, and it is validated as an array of addresses.
  const res = await fetch(
    `${BASE}/inboxes/${encodeURIComponent(ZOLA_INBOX)}/messages/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
      // An array of exactly one, always the owner. There is no code path that
      // puts anything else in here.
      body: JSON.stringify({ to: [owner], subject, text: body }),
    },
  );

  if (!res.ok) {
    return {
      ok: false,
      reason: `AgentMail ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  return { ok: true };
}

/**
 * The one automatic letter, back to whoever wrote in.
 *
 * Note what is NOT a parameter here and never will be: a choice of recipient.
 * `to` is the envelope of the message being answered, lifted straight off the
 * inbound mail — it is not a decision, and no model touches it. That is the
 * same rule `emailOwner` above obeys from the other direction, and together
 * they are the whole of what can leave this address: a notification to Tarik,
 * and a reply to someone who wrote first.
 *
 * There is deliberately no function on this client that sends to an address
 * somebody picked.
 */
export async function replyToSender(
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.AGENTMAIL_API_KEY?.trim();
  if (!key) return { ok: false, reason: "AGENTMAIL_API_KEY is not set" };
  if (!to.includes("@")) return { ok: false, reason: "no recipient on the message" };

  const res = await fetch(
    `${BASE}/inboxes/${encodeURIComponent(ZOLA_INBOX)}/messages/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        to: [to],
        subject,
        text: body,
        ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
      }),
    },
  );

  if (!res.ok) {
    return {
      ok: false,
      reason: `AgentMail ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  return { ok: true };
}
