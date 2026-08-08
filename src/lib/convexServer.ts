import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

// Shared server-route plumbing: the one Convex client (was five identical
// module-level copies) and the one tool-secret check (was two).

let client: ConvexHttpClient | null = null;
export function convexServer(): ConvexHttpClient {
  client ??= new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  return client;
}

// Returns the secret when the request carries it, else the 401 to send.
export function requireToolSecret(
  req: NextRequest,
): { secret: string } | { deny: NextResponse } {
  const secret = process.env.MORPHEUS_TOOL_SECRET;
  if (!secret || req.headers.get("x-morpheus-secret") !== secret) {
    return { deny: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { secret };
}
