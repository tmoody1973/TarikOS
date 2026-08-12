// Email to exactly one person: Tarik.
//
// This is NOT a send path for Zola, and the difference is the whole design.
// "Zola drafts; only a human sends" governs correspondence — mail that goes to
// other people, as him. A reminder is a notification to himself, and it is
// built in the shape `call_tarik` established: the recipient is not a parameter
// of anything, it comes from OWNER_EMAIL on the server, so there is no argument
// to pass and nothing to talk her into.
//
// It also never touches Gmail. The Gmail guardrail stays literally intact:
// there is still no send path in the tool route, and this could not become one
// without someone adding a recipient argument that does not exist.

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Where reminders come from.
 *
 * `onboarding@resend.dev` is Resend's shared sending address. It works with no
 * domain verification at all, and only delivers to the address that owns the
 * Resend account — which is exactly the one recipient this file is allowed to
 * reach, so the restriction costs nothing here. Set RESEND_FROM once a domain
 * is verified and reminders arrive from something that looks like Tarik OS.
 */
function from(): string {
  return process.env.RESEND_FROM?.trim() || "Zola <onboarding@resend.dev>";
}

export async function emailOwner(
  subject: string,
  body: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.OWNER_EMAIL?.trim();
  // Said, not swallowed. An unconfigured channel that reports success is a
  // reminder he never gets and never learns he never got.
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set" };
  if (!to) return { ok: false, reason: "OWNER_EMAIL is not set" };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: from(),
      // An array of exactly one, always the owner. There is no code path that
      // puts anything else in here.
      to: [to],
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    return { ok: false, reason: `Resend ${res.status}: ${(await res.text()).slice(0, 160)}` };
  }
  return { ok: true };
}
