// Voyage AI embeddings (chosen at plan time over OpenAI: Anthropic's
// recommended partner, voyage-3.5-lite, 1024 dims, generous free tier).
// Pure fetch helper — no Convex imports — usable from Convex actions and tests.

export const VOYAGE_MODEL = "voyage-3.5-lite";
export const EMBEDDING_DIMENSIONS = 1024;

export async function voyageEmbed(
  apiKey: string,
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { index: number; embedding: number[] }[];
  };
  const rows = json.data ?? [];
  // Voyage returns entries with an index field; order by it defensively.
  const out: number[][] = new Array(texts.length);
  for (const row of rows) out[row.index] = row.embedding;
  if (out.some((e) => !Array.isArray(e))) {
    throw new Error("Voyage returned an incomplete embedding batch");
  }
  return out;
}
