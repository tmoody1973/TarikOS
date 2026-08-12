# Dial instead of Telnyx? — research handoff

**Date:** 2026-08-11
**Status:** Research. No decision made, no code written.
**Prompted by:** Dial's CEO emailed Tarik; the platform looks far easier to set
up than Telnyx.

> **The short version.** Dial cannot replace Telnyx here, because **Dial has no
> SIP trunking** and `call_tarik` is an ElevenLabs SIP outbound call. But Dial
> looks like a good answer to the half of Telnyx that has been *blocked since
> 9 August*: SMS. The realistic move is a split, not a replacement.

## What Telnyx actually does in this codebase

Worth pinning down first, because "replace Telnyx" is a bigger sentence than
what Telnyx is currently load-bearing for.

| Surface | Provider | State |
|---|---|---|
| The number +1 414 635 2386 | Telnyx | Live, costs money |
| Outbound voice (`call_tarik`) | **ElevenLabs SIP trunk** | Working. Telnyx supplies the number; ElevenLabs places the call and *is* the agent |
| Inbound SMS (`/api/sms/inbound`) | Telnyx | Receives and verifies Ed25519 — **captures shape only, never replies** |
| Outbound SMS | — | **Does not exist.** Blocked on 10DLC |

So Telnyx is doing two jobs: it is the SIP-capable number ElevenLabs dials
through, and it is an inbound SMS webhook that deliberately does not answer.

The reason it does not answer is written into `src/app/api/sms/inbound/route.ts`:
outbound A2P on this long code needs 10DLC registration, which has not been
done, so replies would be filtered or blocked by US carriers and a reply loop
built today could not be honestly tested. A Sole Proprietor registration was
drafted on 10 August and never completed.

**That is the actual pain.** Not Telnyx's setup in general — one specific
registration that has been open for two days and blocks the whole text channel.

## What Dial is

"Gives your AI agent a phone number." SMS send and receive, AI voice calls,
inbound event streaming, number provisioning. REST API, a CLI (`dial ... --json`,
built for agents to shell out to), an MCP server, and SDKs for Node, Python,
LangChain and the Vercel AI SDK.

Auth is a `sk_live_` bearer token. Webhooks are signed HTTP POSTs with HMAC
verification, retries and a `webhook.ping` for testing — the same shape as the
Ed25519 verification already written for Telnyx, so that code has a sibling
rather than a rewrite.

Events: `message.received`, `call.status_changed`, `call.ended`,
`call.transcribed`.

## The finding that decides it

**Dial offers no SIP trunking and no number porting.** Their own Telnyx
comparison page says so plainly, and lists "SIP, trunking, number porting" as
Telnyx strengths they do not match.

`call_tarik` posts to `api.elevenlabs.io/v1/convai/sip-trunk/outbound-call` with
an `agent_phone_number_id`. That requires a SIP-capable number imported into
ElevenLabs. **A Dial number cannot do that job.**

Dial's "self-hosted" mode points Dial at *your* WebSocket server so you drive
the call with your own LLM or raw audio. That is a different architecture from
ElevenLabs ConvAI, which owns the whole conversation loop — turn-taking,
interruption, the voice, the tool calls. Moving voice to Dial means **replacing
Zola's voice stack**, not swapping a carrier.

That may one day be worth it. It is not "an easier setup".

## What Dial is genuinely better at

**Compliance.** Dial claims 10DLC/A2P registration is handled inside the
platform and numbers text immediately; Telnyx needs brand registration plus
campaign vetting, roughly three business days of carrier review. *This claim is
the thing to verify first — it is the entire reason to bother.*

**Pricing**, for this shape of use:

| | Telnyx | Dial |
|---|---|---|
| Number | from $1/mo | $3/mo PAYG, or $20/mo flat with US calls and SMS included |
| SMS | $0.004/segment + carrier fees | $0.02/msg all-in |
| Voice AI | $0.05/min + separate LLM tokens | $0.22/min managed, $0.13/min with your own LLM |

Telnyx is cheaper per unit. Dial is cheaper to *finish*, which is the relevant
currency when the feature has been blocked for two days. At Tarik's volume — one
person texting his own assistant — the per-message difference is cents a month.

There is $5 of free credit with no card, which is enough to answer the only
question that matters.

## Recommendation

**Split, do not replace.**

1. **Keep Telnyx for the number ElevenLabs dials through.** It is working, and
   nothing else offers the SIP trunk it needs.
2. **Try Dial for SMS**, on their free credit, before deciding anything. One
   afternoon: provision a number, send a text, receive a reply, verify a
   webhook signature.
3. **If the compliance claim holds**, move `/api/sms/inbound` to Dial and
   finally build the reply loop that 10DLC has been blocking. Telnyx's SMS
   webhook then gets deleted rather than maintained alongside.

Cost of the split: about $4/month, against a Telnyx number that already costs
money and a text channel that does not work.

## The question that decides it, and how to answer it in an hour

> Can a Dial number send an outbound SMS to Tarik's phone, today, with no
> registration wait?

Everything else follows. If yes, the SMS half moves. If it needs the same 10DLC
dance, Dial's advantage evaporates and finishing the Telnyx Sole Proprietor
registration is the cheaper path.

```
# $5 free credit, no card
dial numbers purchase --json
dial messages send --to "$OWNER_PHONE" --text "test from Dial" --json
```

## Open questions

1. **Does the compliance claim survive contact?** Everything rests on it.
2. **What is the inbound webhook payload actually shaped like?** The house rule,
   now proven three times here: validate a vendor payload against one real
   message before writing a parser against it. Telnyx's own docs omitted
   `data.payload.from`.
3. **Would a second number confuse things?** Tarik would have a Telnyx number
   that calls and a Dial number that texts. Two numbers is a small tax on a
   person's memory. Porting the Telnyx number to Dial is not an option — they
   do not port.
4. **Is `call_tarik` worth its number at all?** Raised on 10 August; he said
   keep it. If that ever changes, Telnyx leaves entirely and Dial becomes the
   only provider.
5. **Their CLI and MCP server are built for agents.** Worth a look independently
   of the SMS question — `dial ... --json` is a shape this project could use
   directly rather than wrapping.

## Not evaluated

WhatsApp, iMessage ($250/month, and Tarik has no use for it), RCS (Dial does not
treat it as first-class), voice through Dial at all, and their self-hosted
WebSocket protocol — all out of scope until the SMS question is answered.
