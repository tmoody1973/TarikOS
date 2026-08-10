import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { convexServer } from "@/lib/convexServer";
import { getPresignedDownloadUrl } from "@/lib/r2";

// The one route that answers without a Clerk session — exempted in proxy.ts
// alongside /api/tools. There is no cookie here and nothing to rate-limit
// against: the slug, its expiry, its revocation and its download cap are the
// entire access control.
//
// So every way this can fail answers identically. Unknown slug, revoked,
// expired, cap-exceeded, missing document, R2 down — one status, one body,
// no hint about which. A different response for "revoked" than for "never
// existed" tells a stranger they guessed a real slug.

/**
 * Five minutes, whatever the link's own window is. A 90-day share link still
 * hands out URLs that die almost immediately, so a redirect target copied out
 * of a browser's network tab is worthless within the hour while the link
 * itself keeps working.
 */
const SHARE_PRESIGN_SECONDS = 300;

/** The only response this route gives to anything that isn't a live link. */
function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  try {
    const result = await convexServer().mutation(api.documents.resolveShare, {
      secret: process.env.MORPHEUS_TOOL_SECRET ?? "",
      slug,
    });
    if (!result.ok) return notFound();

    const url = await getPresignedDownloadUrl(
      result.objectKey,
      result.filename,
      SHARE_PRESIGN_SECONDS,
    );
    // The URL leaves only as a Location header. Putting it in a body would
    // outlive the redirect and end up in logs, histories and screenshots.
    return NextResponse.redirect(url, 302);
  } catch {
    // Including a misconfigured R2 or an unreachable Convex. A stack trace or
    // a 500 here would separate "broken" from "never existed", which is
    // exactly the distinction this route must not draw.
    console.error("share: /f lookup failed");
    return notFound();
  }
}
