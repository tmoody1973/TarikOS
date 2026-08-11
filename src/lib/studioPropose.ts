import Anthropic from "@anthropic-ai/sdk";
import {
  SemanticConventions,
  OpenInferenceSpanKind,
  LLMProvider,
} from "@arizeai/openinference-semantic-conventions";
import { safeSlice } from "../../convex/workflowLib.ts";
import { studioSystemPrompt } from "../../convex/studioLib.ts";
import { getTracer, safeSetAttrs, safeEndSpan } from "./tracing.ts";

// The rewrite behind `propose_studio_edit` — Zola's half of voice editing.
//
// The prompt is `studioSystemPrompt`, the SAME one the editor's ⌘J menu uses.
// Two prompts would let the editor and the voice become different editors: the
// one on screen keeping his voice while the one on the phone reaches for
// corporate register, on the same document, an hour apart.
//
// The model is given ONE block. Not the document — a model handed the whole
// thing rewrites more than it was asked to, and the caller has no way to tell
// which parts changed. One block in, one block out, and the diff is exact.

const MODEL = "claude-opus-5";

/** How much of a block goes to the model. A paragraph is never near this. */
const BLOCK_MAX = 6000;

const REWRITE_SCHEMA = {
  type: "object" as const,
  properties: {
    rewritten: {
      type: "string" as const,
      description:
        "The rewritten passage as plain text. No markdown, no quotation marks around it, no explanation.",
    },
  },
  required: ["rewritten"],
  additionalProperties: false,
};

export async function proposeRewrite(args: {
  docType: string;
  references: { sourceType: string; label: string }[];
  block: string;
  instruction: string;
}): Promise<string> {
  const prompt = [
    `Tarik asked you to do this to one passage of the document: "${safeSlice(args.instruction, 600)}"`,
    "",
    "The passage:",
    safeSlice(args.block, BLOCK_MAX),
    "",
    "Rewrite that passage and nothing else. It is one block of a longer document,",
    "so it must still read as part of it — do not add a heading, do not summarise",
    "what came before, and do not close it off as if it were the end.",
  ].join("\n");

  const client = new Anthropic();
  const span = getTracer().startSpan("llm.studio_propose");
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
      system: studioSystemPrompt({
        docType: args.docType,
        references: args.references,
      }),
      output_config: { format: { type: "json_schema", schema: REWRITE_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    safeSetAttrs(span, {
      [SemanticConventions.LLM_TOKEN_COUNT_PROMPT]: response.usage?.input_tokens,
      [SemanticConventions.LLM_TOKEN_COUNT_COMPLETION]: response.usage?.output_tokens,
      [SemanticConventions.LLM_FINISH_REASON]: response.stop_reason,
    });
    if (response.stop_reason === "refusal") {
      throw new Error("The rewriting model refused the request");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("The rewrite returned no text content");
    }
    const rewritten = String(JSON.parse(text.text).rewritten ?? "").trim();
    // An empty rewrite stored as a proposal would offer to delete the
    // paragraph, which is never what "tighten this" meant.
    if (!rewritten) throw new Error("The rewrite came back empty");
    safeSetAttrs(span, { [SemanticConventions.OUTPUT_VALUE]: rewritten });
    safeEndSpan(span);
    return rewritten;
  } catch (error) {
    safeEndSpan(span, error);
    throw error;
  }
}
