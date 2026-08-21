# 04 — What happens to a record nobody touches

Type: grilling
Status: open
Blocked by: —

## Question

The PRD has `stale`, `archived`, `superseded`, and an `expiresAt` — but staleness is
surfaced *for review*, which means decay costs attention instead of saving it. Nothing in
the system forgets on its own.

Every long-lived personal system needs a way for unimportant things to sink without a human
deciding they should. The question is what "sink" means here:

- **Quiet demotion:** stale records rank lower in recall and are never volunteered, but
  remain findable when asked directly. No review item, no notification.
- **Hard expiry:** `expiresAt` passes and the record is archived automatically, with an
  undo window.
- **Nothing:** everything persists at equal weight; the graph grows forever.

Also decide whether "touched" means read, cited by Zola, edited, or only explicitly
confirmed — the definition determines what survives.
