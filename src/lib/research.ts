import { Composio } from "@composio/core";

export type ResearchResult = { title: string; url: string; snippet: string };

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// Primary research: Composio's managed Tavily search (no connected account
// needed, billed to existing Composio credits).
export async function composioResearch(
  query: string,
): Promise<ResearchResult[]> {
  const result = await composio.tools.execute("COMPOSIO_SEARCH_TAVILY", {
    userId: "tarik",
    arguments: { query },
    dangerouslySkipVersionCheck: true,
  });
  if (!result.successful) {
    throw new Error(`Composio search failed: ${result.error ?? "unknown"}`);
  }
  type TavilyResult = { title?: string; url?: string; content?: string };
  const data = (result.data ?? {}) as { results?: TavilyResult[] };
  return (data.results ?? []).slice(0, 6).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 220),
  }));
}

// Secondary research: AgentKey's unified gateway (Brave web search).
// Free plan has limited credits (~0.6/call) — used when explicitly asked
// or as a second opinion.
export async function agentkeyResearch(
  query: string,
): Promise<ResearchResult[]> {
  const res = await fetch("https://api.agentkey.app/v1/tools/execute", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AGENTKEY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Brave/getWebSearch",
      params: { q: query, count: 6 },
    }),
  });
  if (!res.ok) {
    throw new Error(`AgentKey ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  type BraveResult = { title?: string; url?: string; description?: string };
  const payload = (await res.json()) as {
    data?: { web?: { results?: BraveResult[] } };
  };
  return (payload.data?.web?.results ?? []).slice(0, 6).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: (r.description ?? "").replace(/<[^>]+>/g, "").slice(0, 220),
  }));
}
