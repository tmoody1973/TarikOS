// Dump the live tool definitions and persona prompt to evals/tools.json for
// the replay harness. Run: node evals/export_tools.ts
//
// This reads from scripts/provision-agent.ts — the same constants that get
// sent to ElevenLabs — so the harness always scores the descriptions that are
// actually deployed. It never writes them back.
import { writeFileSync } from "node:fs";
import { TOOLS, PERSONA } from "../scripts/provision-agent.ts";

type WebhookTool = {
  name: string;
  description: string;
  apiSchema?: {
    requestBodySchema?: {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
  };
};

const tools = (TOOLS as unknown as WebhookTool[]).map((t) => ({
  name: t.name,
  description: t.description,
  properties: t.apiSchema?.requestBodySchema?.properties ?? {},
  required: t.apiSchema?.requestBodySchema?.required ?? [],
}));

// The persona carries a {{standing_context}} placeholder that ElevenLabs fills
// per session. The harness has no session, so leave it visible rather than
// silently substituting something that was never there.
writeFileSync(
  new URL("./tools.json", import.meta.url),
  JSON.stringify({ persona: PERSONA, tools }, null, 2),
);

console.log(`Wrote evals/tools.json — ${tools.length} tools`);
