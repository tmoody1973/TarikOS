import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2, as thin a wrapper as the boundary allows: put bytes, sign a
// URL. Nothing here knows what a share link is.
//
// R2 rather than Convex file storage because the requirement is presigned,
// time-boxed, *revocable external* access — a link that keeps working for a
// stranger after Tarik kills it is the failure mode this whole feature exists
// to avoid. Revocation lives in Convex; this module only ever mints a URL
// that dies on its own shortly after.

/** SigV4's own ceiling. Beyond this the signer refuses, so we refuse first. */
export const MAX_PRESIGN_SECONDS = 604800; // 7 days

/** Long enough to click, short enough that a copied URL goes stale. */
export const DEFAULT_PRESIGN_SECONDS = 300;

export type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

const ENV_KEYS = {
  accountId: "R2_ACCOUNT_ID",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucket: "R2_BUCKET",
  endpoint: "R2_ENDPOINT",
} as const;

/**
 * All five or nothing, and every absent one named at once — otherwise setting
 * R2 up is five deploys, one per error message. A whitespace-only value counts
 * as missing: Vercel will hold an env var set to "".
 */
export function requireR2Env(): R2Env {
  const found = Object.entries(ENV_KEYS).map(([field, key]) => {
    const value = process.env[key]?.trim();
    return { field, key, value };
  });

  const missing = found.filter((f) => !f.value).map((f) => f.key);
  if (missing.length > 0) {
    throw new Error(
      `R2 is not configured — missing ${missing.join(", ")}. ` +
        `Set these in Vercel, not .env.local.`,
    );
  }

  return Object.fromEntries(
    found.map((f) => [f.field, f.value as string]),
  ) as unknown as R2Env;
}

/**
 * Built per call rather than at module load, so importing this file — which
 * a route does simply by existing — never depends on the credentials being
 * present. `region: "auto"` is R2's; it has no regions to choose between.
 */
function client(env: R2Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

/** In range, or a clear error instead of an opaque one from the signer. */
export function checkPresignWindow(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Presign expiry must be a positive number of seconds.`);
  }
  if (seconds > MAX_PRESIGN_SECONDS) {
    throw new Error(
      `Presign expiry may not exceed ${MAX_PRESIGN_SECONDS} seconds (7 days).`,
    );
  }
  return seconds;
}

/**
 * A Content-Disposition the filename cannot break out of.
 *
 * The name reaches here from a document title, so it is untrusted text going
 * into a response header: a CR or LF would end the header and start another
 * one. Non-ASCII is carried in the RFC 5987 `filename*` form with an ASCII
 * fallback, which is what every current browser reads.
 */
export function contentDisposition(filename: string): string {
  // Strip first, split second. Sanitizing only the ASCII fallback leaves the
  // dangerous characters alive in `filename*` — percent-encoded, so they
  // can't break the header, but they decode straight back into the name the
  // browser saves. Quotes close the quoted-string early, backslashes escape
  // the next character, control characters end the header outright. None of
  // them belong in a filename in either form.
  const safe = filename.replace(/["\\\x00-\x1f\x7f]/g, "").trim() || "download";

  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").trim() || "download";

  const header = `attachment; filename="${ascii}"`;
  return safe === ascii
    ? header
    : `${header}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Store bytes. The key is the caller's to choose and to remember. */
export async function uploadBuffer(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const env = requireR2Env();
  await client(env).send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * A URL that works without credentials and stops working shortly after. Mint
 * one per visit and never store it — a stored URL outlives the revocation
 * that was supposed to kill it.
 */
export async function getPresignedDownloadUrl(
  key: string,
  filename: string,
  expiresInSeconds: number = DEFAULT_PRESIGN_SECONDS,
): Promise<string> {
  const expiresIn = checkPresignWindow(expiresInSeconds);
  const env = requireR2Env();
  return await getSignedUrl(
    client(env),
    new GetObjectCommand({
      Bucket: env.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(filename),
    }),
    { expiresIn },
  );
}
