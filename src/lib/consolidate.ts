import Anthropic from "@anthropic-ai/sdk";

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
};

export type ConsolidationOps = {
  newMemories: {
    content: string;
    type: "preference" | "fact" | "project" | "person";
    transcriptId?: string;
  }[];
  updates: { id: string; content: string }[];
  deletes: string[];
};

const MEMORY_TYPES = ["preference", "fact", "project", "person"] as const;

export const OPS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["new_memories", "updates", "deletes"],
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
  return `You maintain the long-term memory of Zola, Tarik Moody's personal AI. Below are the existing memories and today's conversation transcripts.

Extract durable facts about Tarik — his preferences, projects, people in his life, and stable facts — that are worth remembering long-term and are NOT already captured in the existing memories. Ignore small talk, one-off logistics, and anything ephemeral.

Also maintain the existing set:
- If a transcript contradicts an existing memory, UPDATE that memory (updates) rather than adding a duplicate.
- If two existing memories say the same thing, merge them: UPDATE one with the combined wording and DELETE the other.
- When in doubt, do nothing — an empty result is fine. Never invent facts not present in the transcripts.

For each new memory, set transcript_index to the transcript it came from.

EXISTING MEMORIES:
${memories || "(none)"}

TODAY'S TRANSCRIPTS:
${transcripts}`;
}

type RawOps = {
  new_memories?: { content?: unknown; type?: unknown; transcript_index?: unknown }[];
  updates?: { memory_id?: unknown; content?: unknown }[];
  deletes?: unknown[];
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
  return { newMemories, updates, deletes: [...deleteSet] };
}

export async function runConsolidation(
  input: ConsolidationInput,
): Promise<ConsolidationOps> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: OPS_SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("Consolidation model refused the request");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Consolidation returned no text content");
  }
  return opsFromResponse(JSON.parse(text.text), input);
}
