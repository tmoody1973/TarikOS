import { NextRequest, NextResponse } from "next/server";
import Telnyx from "telnyx";
import { isAllowedSender } from "@/lib/smsAllowlist";

// Telnyx inbound SMS (MOO-497). Exempted from Clerk in proxy.ts alongside
// /api/tools: the caller is Telnyx, not a browser, and it authenticates with
// an Ed25519 signature rather than a session.
//
// THIS PASS CAPTURES, IT DOES NOT REPLY. The reply loop is deliberately not
// wired yet, for two reasons:
//
//   1. `data.payload.from` does not appear in Telnyx's own documented payload
//      table — neither the inline one nor the full reference. The house rule
//      that has now been proven three times is to validate a vendor payload
//      against one real message before writing a parser against it.
//   2. Outbound A2P on this long code needs 10DLC registration, which has not
//      been done. Replies would be filtered or blocked by US carriers, so a
//      reply loop built today could not be honestly tested.
//
// So this logs the SHAPE of what arrives — keys, not values. The values are
// Tarik's text messages, and the deployment log is not where they belong.

/** Ed25519 verification, from the vendor's own SDK rather than hand-rolled. */
const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY ?? "",
  // The Ed25519 public key the signature is checked against, from
  // GET /v2/public_key. Public by name and by nature — it verifies, it cannot
  // sign — but it lives in an env var so a key rotation is a config change.
  publicKey: process.env.TELNYX_PUBLIC_KEY ?? "",
});

/** Key paths only, never leaf values — the leaves are message contents. */
function shapeOf(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 3 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${prefix}[] (empty)`]
      : shapeOf(value[0], `${prefix}[0]`, depth + 1);
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = shapeOf(child, path, depth + 1);
    return nested.length > 0 ? nested : [`${path}: ${typeof child}`];
  });
}

export async function POST(req: NextRequest) {
  // The raw body, not the parsed one: the signature covers the exact bytes,
  // and re-serializing JSON changes them.
  const raw = await req.text();

  let event: { data?: { event_type?: string; payload?: Record<string, unknown> } };
  try {
    event = telnyx.webhooks.unwrap(raw, {
      headers: Object.fromEntries(req.headers.entries()),
    }) as typeof event;
  } catch (error) {
    // A failed signature is the shape an unauthenticated caller produces, so
    // it is logged without the body and answered without detail.
    console.warn(
      `sms: signature verification failed — ${error instanceof Error ? error.message : "unknown"}`,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.data?.event_type !== "message.received") {
    // Delivery receipts land here too once outbound exists. Acknowledged so
    // Telnyx stops retrying, and otherwise ignored.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const payload = event.data.payload ?? {};
  const from = (payload.from as { phone_number?: string } | undefined)
    ?.phone_number;

  if (!isAllowedSender(from, process.env.OWNER_PHONE)) {
    // Silently. Any reply — even a refusal — confirms the number is live and
    // costs a segment per probe.
    console.warn("sms: dropped a message from a non-allowlisted sender");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // The capture the house rule asks for. Shape only.
  console.log(`sms: inbound payload shape — ${shapeOf(event.data).join(", ")}`);
  console.log(
    `sms: from resolved to ${from ? "a phone number" : "UNDEFINED — parser needs fixing"}`,
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
