import { NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getPresignedDownloadUrl } from "@/lib/r2";
import { isOwner } from "@/lib/owner";

// The owner's own download. Clerk-gated by proxy.ts, and gated again here —
// this route hands out a working URL to a private file, and a route that
// leans on middleware alone breaks silently the day the matcher changes.
//
// The URL is minted per click and never rendered into the page. One embedded
// in the markup outlives the page it was drawn on: it survives in
// view-source, in a screenshot, in a tab handed to someone else, and unlike a
// share link there is nothing to revoke.

/** Long enough to start a download, short enough to be worthless if copied. */
const OWNER_PRESIGN_SECONDS = 120;

export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId || !(await isOwner())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const token = (await getToken({ template: "convex" })) ?? undefined;
  const doc = await fetchQuery(
    api.documents.downloadTarget,
    { documentId: id as Id<"documents"> },
    { token },
  );
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = await getPresignedDownloadUrl(
    doc.objectKey,
    doc.filename,
    OWNER_PRESIGN_SECONDS,
  );
  return NextResponse.redirect(url, 302);
}
