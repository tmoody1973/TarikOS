import Anthropic from "@anthropic-ai/sdk";
import { safeSlice } from "../../convex/workflowLib.ts";
import type { MailMessage } from "./mail.ts";

// Zola's email drafting (MOO-494) — server-side Claude, consolidation
// pattern. Writes a body ONLY; creating the Gmail draft happens in the tool
// route, and sending exists nowhere in this path.

const BODY_SCHEMA = {
  type: "object" as const,
  properties: {
    bodyHtml: {
      type: "string" as const,
      description:
        "The email body as simple HTML (<p>, <strong>, <em>, <ul>/<li>, <a> only). No subject line, no signature block beyond a simple sign-off.",
    },
  },
  required: ["bodyHtml"],
  additionalProperties: false,
};

function threadContext(messages: MailMessage[]): string {
  return messages
    .slice(-6)
    .map(
      (m) =>
        `From: ${m.from}\nDate: ${m.date}\n${safeSlice(
          m.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          2400,
        )}`,
    )
    .join("\n---\n");
}

export async function draftEmailBody(args: {
  intent: string;
  to: string;
  subject: string;
  thread?: MailMessage[];
}): Promise<string> {
  const context = args.thread?.length
    ? `You are replying to this email thread (oldest to newest):\n\n${threadContext(args.thread)}\n\n`
    : "";
  const prompt = `You are Zola, drafting an email on behalf of Tarik Moody (radio host and technologist in Milwaukee). Write in Tarik's voice: warm, direct, concise, no corporate filler. Sign off simply (e.g. "— Tarik").

${context}To: ${args.to}
Subject: ${args.subject}

Tarik's instruction for this email: "${safeSlice(args.intent, 1200)}"

Write only the email body as simple HTML. Keep it short — say what Tarik asked, nothing invented.`;
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: BODY_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("Drafting model refused the request");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Drafting returned no text content");
  }
  const bodyHtml = String(JSON.parse(text.text).bodyHtml ?? "").trim();
  if (!bodyHtml) throw new Error("Drafting returned an empty body");
  return bodyHtml;
}
