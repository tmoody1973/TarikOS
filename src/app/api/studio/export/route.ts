import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { DOCX_CONTENT_TYPE, objectKeyFor, studioExportName } from "@/lib/documentBuilders";
import { uploadBuffer } from "@/lib/r2";

// Studio → .docx → the store that already knows how to share things.
//
// The point is not the file. It is that the file lands in `documents`, which
// already does presigned URLs, expiry, download caps and revocation — so an
// export inherits a whole distribution system instead of growing a second one.
// The same reasoning that made Studio LINK to briefs rather than own them:
// one canonical store per kind of thing, and `documents` is "an artifact I can
// hand to someone".
//
// The .docx itself is generated in the browser, because that is where Plate's
// exporter runs. This route only receives the bytes, stores them, and records
// the row. It is Clerk-gated: it writes to Tarik's bucket.

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * A text document exports to tens of kilobytes; embedded images are what make
 * one large. Bounded so a single click cannot decide how much R2 storage it
 * costs, and refused rather than truncated — half a .docx is a corrupt file.
 */
const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const title = String(form?.get("title") ?? "").trim();
  const sourceId = String(form?.get("sourceId") ?? "").trim();
  const revision = Number(form?.get("revision") ?? 0);

  if (!(file instanceof Blob) || !sourceId || !Number.isFinite(revision)) {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  if (file.size > MAX_EXPORT_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That document is too large to export." },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const now = Date.now();
  // Both from the shared helper. objectKeyFor carries the traversal and
  // collision rules — the title reaches here from a text field, and a
  // hand-rolled key here would quietly skip both.
  const objectKey = objectKeyFor(title || "document", "docx", now);
  const filename = studioExportName(title, revision, now);

  // The bytes go to the bucket BEFORE the row is written. The other order
  // leaves a document listed on /documents that 404s when downloaded.
  await uploadBuffer(objectKey, bytes, DOCX_CONTENT_TYPE);

  const { documentId } = await convex.mutation(api.documents.saveDocument, {
    secret: process.env.MORPHEUS_TOOL_SECRET!,
    title: title || "Untitled document",
    sourceType: "studio",
    // Which Studio document this came from. A year later the .docx still
    // points at the thing it was written in.
    sourceId,
    objectKey,
    filename,
    contentType: DOCX_CONTENT_TYPE,
    sizeBytes: bytes.byteLength,
  });

  return NextResponse.json({ ok: true, documentId, filename });
}
