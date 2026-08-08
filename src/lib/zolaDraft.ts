import Anthropic from "@anthropic-ai/sdk";
import {
  SemanticConventions,
  OpenInferenceSpanKind,
  LLMProvider,
} from "@arizeai/openinference-semantic-conventions";
import { safeSlice } from "../../convex/workflowLib.ts";
import { getTracer, safeSetAttrs, safeEndSpan } from "./tracing.ts";
import type { MailMessage } from "./mail.ts";

const MODEL = "claude-opus-5";

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
  const span = getTracer().startSpan("llm.draft_email");
  safeSetAttrs(span, {
    [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.LLM,
    [SemanticConventions.LLM_MODEL_NAME]: MODEL,
    [SemanticConventions.LLM_PROVIDER]: LLMProvider.ANTHROPIC,
    [SemanticConventions.INPUT_VALUE]: prompt,
  });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: BODY_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    safeSetAttrs(span, {
      [SemanticConventions.LLM_TOKEN_COUNT_PROMPT]: response.usage?.input_tokens,
      [SemanticConventions.LLM_TOKEN_COUNT_COMPLETION]: response.usage?.output_tokens,
      [SemanticConventions.LLM_FINISH_REASON]: response.stop_reason,
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
    safeSetAttrs(span, { [SemanticConventions.OUTPUT_VALUE]: bodyHtml });
    safeEndSpan(span);
    return bodyHtml;
  } catch (error) {
    // Every throw path above lands here, so the span is always closed and the
    // error recorded. The error itself is rethrown unchanged.
    safeEndSpan(span, error);
    throw error;
  }
}
