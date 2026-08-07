import { NextRequest, NextResponse } from "next/server";
import { extractArticle, ReaderError } from "@/lib/reader";

// Reader-pane extraction endpoint. Clerk-gated by proxy.ts (not in the
// public-route list), so only a signed-in session can reach it.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "Missing url parameter" },
      { status: 400 },
    );
  }
  try {
    const article = await extractArticle(url);
    return NextResponse.json({ ok: true, article });
  } catch (error) {
    const message =
      error instanceof ReaderError
        ? error.message
        : "Couldn't read that page.";
    if (!(error instanceof ReaderError)) {
      console.error("reader extraction failed:", error);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
