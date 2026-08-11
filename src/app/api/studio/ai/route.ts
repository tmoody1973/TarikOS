import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@clerk/nextjs/server";
import { studioSystemPrompt } from "../../../../../convex/studioLib";

// Studio's AI editing (Phase 3).
//
// Clerk-gated, unlike /api/tools: the caller is the editor in a browser with a
// session, not Zola calling a webhook with a shared secret. proxy.ts exempts
// /api/tools from Clerk; this route is deliberately NOT exempt.
//
// Plate's AI kit supplies the machinery — the menu, the streaming, the diff
// and the accept/reject. What it cannot supply is whose assistant this is, and
// what the document is grounded in. That is this file.
//
// The model is Claude through the key that already exists in this project
// rather than the Vercel AI Gateway Plate's examples use, so there is no new
// secret to provision and it is Zola's own model doing the writing.

/** Claude does the writing here, the same voice as everywhere else. */
const MODEL = "claude-sonnet-5";

/**
 * Long enough for a section rewrite, short enough that a runaway generation
 * cannot bill indefinitely. An edit that needs more than this is a document
 * being rewritten wholesale, which is not what the menu is for.
 */
const MAX_OUTPUT_TOKENS = 4096;

/** A hard ceiling on how much document may be sent as context. */
const MAX_CONTEXT_CHARS = 60_000;

export const maxDuration = 60;

type Body = {
  messages?: unknown;
  docType?: unknown;
  references?: unknown;
};

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("AI editing is not configured — ANTHROPIC_API_KEY is missing.", {
      status: 503,
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("Nothing to do — no messages.", { status: 400 });
  }

  // References arrive from the client rather than being re-read here. The page
  // is Clerk-gated and already holds them, and a second read would make every
  // keystroke of an AI request wait on a Convex round trip. They are labels
  // only — no ids, no bodies — so nothing sensitive rides along.
  const references = Array.isArray(body.references)
    ? body.references.flatMap((raw) => {
        const r = raw as Record<string, unknown>;
        return typeof r?.sourceType === "string" && typeof r?.label === "string"
          ? [{ sourceType: r.sourceType, label: r.label.slice(0, 120) }]
          : [];
      })
    : [];

  const system = studioSystemPrompt({
    docType: typeof body.docType === "string" ? body.docType : "draft",
    references,
  });

  const messages = await convertToModelMessages(body.messages as never);
  // Bounded rather than trusted. The document is serialized client-side, and a
  // very long one would otherwise decide how large a request this route makes.
  const size = JSON.stringify(messages).length;
  if (size > MAX_CONTEXT_CHARS) {
    return new Response(
      "This document is too long to edit in one pass — select a section instead.",
      { status: 413 },
    );
  }

  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      originalMessages: body.messages as never,
      stream: result.stream,
    }),
  });
}
