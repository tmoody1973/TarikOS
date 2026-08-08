import Anthropic from "@anthropic-ai/sdk";
import {
  SemanticConventions,
  OpenInferenceSpanKind,
  LLMProvider,
} from "@arizeai/openinference-semantic-conventions";
import { TELOS_STATUSES, type TelosStatus } from "../../convex/telosLib.ts";
import { getTracer, safeSetAttrs, safeEndSpan } from "./tracing.ts";

const MODEL = "claude-opus-5";

// Nightly memory consolidation: Claude reads the day's transcripts against
// the existing memory set and returns structured ops (new / update / delete).
// Pure helpers are exported for unit tests; only runConsolidation talks to
// the Anthropic API.

export type ConsolidationInput = {
  transcripts: {
    id: string;
    title: string;
    turns: { role: string; text: string }[];
  }[];
  memories: { id: string; content: string; type: string }[];
  // MOO-489: today's unconsolidated journal entries + active telos items.
  journal: { id: string; text: string; mode: string }[];
  telosItems: { id: string; kind: string; text: string; status: string }[];
};

export type ConsolidationOps = {
  newMemories: {
    content: string;
    type: "preference" | "fact" | "project" | "person";
    transcriptId?: string;
  }[];
  updates: { id: string; content: string }[];
  deletes: string[];
  telosUpdates: {
    id: string;
    text?: string;
    status?: TelosStatus;
    measurable?: string;
    transcriptId?: string;
  }[];
};

const MEMORY_TYPES = ["preference", "fact", "project", "person"] as const;

export const OPS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["new_memories", "updates", "deletes", "telos_updates"],
  properties: {
    new_memories: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["content", "type", "transcript_index"],
        properties: {
          content: { type: "string" as const },
          type: { type: "string" as const, enum: [...MEMORY_TYPES] },
          transcript_index: { type: "integer" as const },
        },
      },
    },
    updates: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["memory_id", "content"],
        properties: {
          memory_id: { type: "string" as const },
          content: { type: "string" as const },
        },
      },
    },
    deletes: { type: "array" as const, items: { type: "string" as const } },
    telos_updates: {
      type: "array" as const,
      // Empty string = "leave unchanged" (schema keeps every field required
      // for structured output; the parser maps sentinels to undefined).
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["telos_id", "text", "status", "measurable", "transcript_index"],
        properties: {
          telos_id: { type: "string" as const },
          text: { type: "string" as const },
          status: { type: "string" as const, enum: ["", ...TELOS_STATUSES] },
          measurable: { type: "string" as const },
          transcript_index: { type: "integer" as const },
        },
      },
    },
  },
};

export function buildPrompt(input: ConsolidationInput): string {
  const memories = input.memories
    .map((m) => `[${m.id}] (${m.type}) ${m.content}`)
    .join("\n");
  const transcripts = input.transcripts
    .map(
      (t, i) =>
        `--- Transcript ${i}: ${t.title} ---\n` +
        t.turns.map((turn) => `${turn.role}: ${turn.text}`).join("\n"),
    )
    .join("\n\n");
  const journal = input.journal
    .map((j) => `[${j.id}] (${j.mode}) ${j.text}`)
    .join("\n");
  const telos = input.telosItems
    .map((t) => `[${t.id}] (${t.kind}) ${t.text}`)
    .join("\n");
  return `You maintain the long-term memory of Zola, Tarik Moody's personal AI. Below are the existing memories, today's conversation transcripts, today's journal entries, and Tarik's active telos (mission/goals/problems).

Extract durable facts about Tarik — his preferences, projects, people in his life, and stable facts — that are worth remembering long-term and are NOT already captured in the existing memories. Ignore small talk, one-off logistics, and anything ephemeral.

Also maintain the existing set:
- If a transcript contradicts an existing memory, UPDATE that memory (updates) rather than adding a duplicate.
- If two existing memories say the same thing, merge them: UPDATE one with the combined wording and DELETE the other.
- When in doubt, do nothing — an empty result is fine. Never invent facts not present in the transcripts.

For each new memory, set transcript_index to the transcript it came from.

Telos maintenance (telos_updates): when a transcript or journal entry shows a real change to a telos item — a completed or abandoned goal, a reworded understanding, a NEW finish line — emit a telos_update for that item's id. The measurable field is the goal's FINISH LINE (deadline/target): change it ONLY when Tarik explicitly changes the finish line itself. Day-to-day progress ("did 30 minutes of practice", "found the right course") belongs in new_memories, NEVER in measurable. Use "" for any field you are not changing, and status "" to leave status alone. Set transcript_index to the source transcript, or -1 if it came from a journal entry. Only report REAL change stated by Tarik; never invent progress, and an empty telos_updates list is the normal case.

EXISTING MEMORIES:
${memories || "(none)"}

ACTIVE TELOS:
${telos || "(none)"}

TODAY'S JOURNAL ENTRIES:
${journal || "(none)"}

TODAY'S TRANSCRIPTS:
${transcripts}`;
}

type RawOps = {
  new_memories?: { content?: unknown; type?: unknown; transcript_index?: unknown }[];
  updates?: { memory_id?: unknown; content?: unknown }[];
  deletes?: unknown[];
  telos_updates?: {
    telos_id?: unknown;
    text?: unknown;
    status?: unknown;
    measurable?: unknown;
    transcript_index?: unknown;
  }[];
};

// Validate Claude's output against reality: drop unknown memory ids, resolve
// transcript indices to ids, drop malformed entries.
export function opsFromResponse(
  raw: RawOps,
  input: ConsolidationInput,
): ConsolidationOps {
  const knownIds = new Set(input.memories.map((m) => m.id));
  const newMemories = (raw.new_memories ?? [])
    .filter(
      (m): m is { content: string; type: string; transcript_index: number } =>
        typeof m.content === "string" &&
        m.content.trim() !== "" &&
        MEMORY_TYPES.includes(m.type as (typeof MEMORY_TYPES)[number]),
    )
    .map((m) => ({
      content: m.content,
      type: m.type as ConsolidationOps["newMemories"][number]["type"],
      transcriptId: input.transcripts[m.transcript_index as number]?.id,
    }));
  const updates = (raw.updates ?? [])
    .filter(
      (u): u is { memory_id: string; content: string } =>
        typeof u.memory_id === "string" &&
        knownIds.has(u.memory_id) &&
        typeof u.content === "string" &&
        u.content.trim() !== "",
    )
    .map((u) => ({ id: u.memory_id, content: u.content }));
  const deleteSet = new Set(
    (raw.deletes ?? []).filter(
      (d): d is string => typeof d === "string" && knownIds.has(d),
    ),
  );
  // Never delete a memory we're also updating.
  for (const u of updates) deleteSet.delete(u.id);
  const knownTelosIds = new Set(input.telosItems.map((t) => t.id));
  const telosUpdates = (raw.telos_updates ?? [])
    .filter(
      (t): t is { telos_id: string } & Record<string, unknown> =>
        typeof t.telos_id === "string" && knownTelosIds.has(t.telos_id),
    )
    .map((t) => ({
      id: t.telos_id,
      text: typeof t.text === "string" && t.text.trim() ? t.text.trim() : undefined,
      status: TELOS_STATUSES.includes(t.status as (typeof TELOS_STATUSES)[number])
        ? (t.status as ConsolidationOps["telosUpdates"][number]["status"])
        : undefined,
      measurable:
        typeof t.measurable === "string" && t.measurable.trim()
          ? t.measurable.trim()
          : undefined,
      transcriptId: input.transcripts[t.transcript_index as number]?.id,
    }))
    // A sentinel-only entry changes nothing — drop it.
    .filter((t) => t.text !== undefined || t.status !== undefined || t.measurable !== undefined);
  return { newMemories, updates, deletes: [...deleteSet], telosUpdates };
}

export async function runConsolidation(
  input: ConsolidationInput,
): Promise<ConsolidationOps> {
  const client = new Anthropic();
  const prompt = buildPrompt(input);
  // The nightly run is the only unattended write path in the system: it
  // inserts, rewrites, and hard-deletes memories that then flow into
  // standingContext and shape every later session. Being able to read exactly
  // what it was asked and what it returned is the point of this span.
  const span = getTracer().startSpan("llm.consolidate_memories");
  safeSetAttrs(span, {
    [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.LLM,
    [SemanticConventions.LLM_MODEL_NAME]: MODEL,
    [SemanticConventions.LLM_PROVIDER]: LLMProvider.ANTHROPIC,
    [SemanticConventions.INPUT_VALUE]: prompt,
    "consolidate.transcript_count": input.transcripts.length,
    "consolidate.existing_memory_count": input.memories.length,
    "consolidate.journal_count": input.journal.length,
  });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: OPS_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    safeSetAttrs(span, {
      [SemanticConventions.LLM_TOKEN_COUNT_PROMPT]: response.usage?.input_tokens,
      [SemanticConventions.LLM_TOKEN_COUNT_COMPLETION]: response.usage?.output_tokens,
      [SemanticConventions.LLM_FINISH_REASON]: response.stop_reason,
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Consolidation model refused the request");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("Consolidation returned no text content");
    }
    const ops = opsFromResponse(JSON.parse(text.text), input);
    // Post-validation counts: what actually survived opsFromResponse, not what
    // the model asked for. Deletes are unrecoverable, so they are recorded.
    safeSetAttrs(span, {
      [SemanticConventions.OUTPUT_VALUE]: text.text,
      "consolidate.new_count": ops.newMemories.length,
      "consolidate.update_count": ops.updates.length,
      "consolidate.delete_count": ops.deletes.length,
      "consolidate.deleted_ids": ops.deletes,
      "consolidate.telos_update_count": ops.telosUpdates.length,
    });
    safeEndSpan(span);
    return ops;
  } catch (error) {
    // Every throw path above lands here, so the span is always closed and the
    // error recorded. The error itself is rethrown unchanged.
    safeEndSpan(span, error);
    throw error;
  }
}
