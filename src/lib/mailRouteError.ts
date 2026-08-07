import { NextResponse } from "next/server";
import { GoogleAuthError } from "@/lib/google";

// One error contract for every /api/mail route: GoogleAuthError message is
// user-facing ("reconnect"), anything else logs server-side and returns the
// route's friendly fallback. Status 200 — the client reads `ok`.
export function mailRouteError(error: unknown, fallback: string): NextResponse {
  const message = error instanceof GoogleAuthError ? error.message : fallback;
  if (!(error instanceof GoogleAuthError)) {
    console.error("mail route failed:", error);
  }
  return NextResponse.json({ ok: false, error: message }, { status: 200 });
}
