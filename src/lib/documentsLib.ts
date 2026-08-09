// Access control for shared documents, as pure functions.
//
// `/f/<slug>` is exempted from Clerk, the same way `/api/tools` is. There is no
// session on that route, no cookie to check, and nothing to rate-limit against
// — so the slug plus the checks below are not *part of* the access control,
// they are all of it. Everything here is a security boundary.
//
// Kept dependency-free (no Convex, no R2, no request object) so the rules can
// be tested directly rather than through a route, the way `habitsLib.ts` and
// `toolOutcome.ts` are.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** 18 random bytes render as exactly 24 base64url characters — ~143 bits. */
export const SLUG_LENGTH = 24;

/**
 * How long a share confirmation stays good. Short on purpose: a long window
 * means one "yes" keeps authorizing shares later in the same conversation,
 * which is the failure the gate exists to prevent.
 */
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type ShareDenialReason = "revoked" | "expired" | "download_cap";

export type ShareLinkState = {
  slug: string;
  expiresAt?: number;
  maxDownloads?: number;
  downloadCount: number;
  revoked: boolean;
};

export type ShareAccessVerdict =
  | { allowed: true }
  | { allowed: false; reasons: ShareDenialReason[] };

/** Url-safe, non-sequential, nothing to escape in a path segment. */
export function newShareSlug(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Every reason a link is dead, not the first one found.
 *
 * An if/else-if chain would return whichever check happened to run first, so a
 * link that was *revoked* and has *also* since expired would read in the logs
 * as merely expired — and the revocation, the deliberate act, would vanish.
 * The caller still shows one opaque response to the visitor; the reasons are
 * for the server side.
 */
export function checkShareAccess(
  link: ShareLinkState,
  now: number,
): ShareAccessVerdict {
  const reasons: ShareDenialReason[] = [];

  if (link.revoked) reasons.push("revoked");
  // Inclusive: a link is dead *at* its expiry, not one millisecond after.
  if (link.expiresAt !== undefined && now >= link.expiresAt) {
    reasons.push("expired");
  }
  if (
    link.maxDownloads !== undefined &&
    link.downloadCount >= link.maxDownloads
  ) {
    reasons.push("download_cap");
  }

  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}

export type ShareConfirmation = {
  token: string;
  documentFileId: string;
  expiresAt: number;
  used: boolean;
};

/** A confirmation is bound to one document and spendable once. */
export function newConfirmation(
  documentFileId: string,
  now: number,
): ShareConfirmation {
  return {
    token: randomBytes(24).toString("base64url"),
    documentFileId,
    expiresAt: now + CONFIRMATION_TTL_MS,
    used: false,
  };
}

/**
 * The gate. No record, wrong token, wrong document, spent, or expired — all
 * false. Denial is the default, because the shapes that reach here without a
 * record are exactly the ones that matter: a caller that skipped the first
 * phase, or a model that decided the step was unnecessary.
 */
export function isConfirmationValid(
  record: ShareConfirmation | undefined | null,
  attempt: { token: string; documentFileId: string; now: number },
): boolean {
  if (!record) return false;
  if (record.used) return false;
  if (attempt.now >= record.expiresAt) return false;
  if (record.documentFileId !== attempt.documentFileId) return false;
  return tokensMatch(record.token, attempt.token);
}

/** Constant-time within a length class; length itself is fixed by construction. */
function tokensMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
