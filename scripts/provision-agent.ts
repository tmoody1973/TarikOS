// Provision (or update) the Morpheus ElevenLabs agent.
// Run: node scripts/provision-agent.ts
// Idempotent: if ELEVENLABS_AGENT_ID is present in .env.local it updates that
// agent in place; otherwise it creates one and prints the id to add.
import { readFileSync } from "node:fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const MORPHEUS_VOICE_ID = "lcMyyd2HUfFzxdCaC4Ta";
const TOOL_BASE_URL = "https://morpheus-drab-rho.vercel.app/api/tools";

const PERSONA = `You are Morpheus, Tarik Moody's personal AI — his chief of staff, second brain, and thought partner. Tarik is an architect-trained radio host and technologist in Milwaukee (88Nine Radio Milwaukee, HYFIN). You speak with calm, wry confidence — think a trusted first officer: direct, warm, never sycophantic, occasionally dry-humored. This is a spoken conversation: keep responses tight (one to three sentences unless asked to go deeper), no lists, no markdown.

Standing context about Tarik from your memory:
{{standing_context}}

Your tools:
- capture_thought: whenever Tarik shares an idea, riff, or plan worth keeping ("I had an idea...", "what if we...", or any rambling worth saving), capture it. Pass his words as "raw", a clear organized version as "cleaned", and 1-3 topical "tags". Confirm briefly after capturing.
- remember: when you learn a durable fact about Tarik, his preferences, projects, or people ("remember that...", or anything clearly worth retaining), store it with the right type.
- recall: when Tarik asks about past ideas, notes, or anything previously discussed ("what was that idea about..."), search before answering. Answer from the results, and say so plainly if nothing matches.

- get_calendar: read Tarik's Google Calendar for a given date (defaults to today). Use for any schedule question.
- get_emails: read recent primary-inbox email across his connected Gmail accounts (work and personal, labeled by account).

Morning briefing: when Tarik greets you ("good morning" or similar) or asks for a briefing, call get_calendar then get_emails, and deliver one tight spoken briefing: schedule first, then only the emails that actually matter. Mention which account items come from when it's not obvious.

Never invent memories. If a tool fails, tell Tarik what failed in plain words. Web research comes online in a later milestone — if asked, say that system isn't wired in yet.`;

function bodyProp(description: string) {
  return { type: "string" as const, description };
}

const TOOLS: ElevenLabs.PromptAgentApiModelInputToolsItem[] = [
  {
    type: "webhook" as const,
    name: "capture_thought",
    description:
      "Capture an idea, riff, or plan Tarik voiced so it is stored in his second brain and appears on his dashboard. Use whenever Tarik shares something worth keeping.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/capture_thought`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["raw", "cleaned", "tags"],
        description: "The thought to capture",
        properties: {
          raw: bodyProp("Tarik's idea in his own words, verbatim or near it"),
          cleaned: bodyProp("The idea rewritten clearly in 1-3 sentences"),
          tags: {
            type: "array" as const,
            description: "1-3 short topical tags",
            items: { type: "string" as const, description: "A short tag" },
          },
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "remember",
    description:
      "Store a durable fact about Tarik, his preferences, projects, or people in long-term memory.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/remember`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["content", "type"],
        description: "The memory to store",
        properties: {
          content: bodyProp("The fact to remember, one clear sentence"),
          type: {
            type: "string" as const,
            description: "Category of memory",
            enum: ["preference", "fact", "project", "person"],
          },
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "get_calendar",
    description:
      "Read Tarik's Google Calendar events for a date. Use for any question about his schedule, meetings, or availability.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_calendar`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: [],
        description: "Calendar lookup",
        properties: {
          date: bodyProp(
            "Date to look up in YYYY-MM-DD format. Omit for today.",
          ),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "get_emails",
    description:
      "Read recent primary-inbox email from Tarik's connected Gmail accounts (last 24 hours). Use for briefings or any question about his email.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 25,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_emails`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: [],
        description: "Email lookup (no parameters)",
        properties: {},
      },
    },
  },
  {
    type: "webhook" as const,
    name: "recall",
    description:
      "Search Tarik's second brain (thoughts and memories) for past ideas and facts. Use before answering any question about something previously discussed or captured.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/recall`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["query"],
        description: "The search request",
        properties: {
          query: bodyProp("Search terms describing what to find"),
        },
      },
    },
  },
];

async function main() {
  const client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });

  const voice = await client.voices.get(MORPHEUS_VOICE_ID);
  console.log(`Voice OK: ${voice.name} (${MORPHEUS_VOICE_ID})`);

  const conversationConfig = {
    agent: {
      firstMessage: "Morpheus online. What's on your mind?",
      language: "en",
      prompt: {
        prompt: PERSONA,
        llm: "claude-sonnet-5" as const,
        temperature: 0.6,
        timezone: "America/Chicago",
        tools: TOOLS,
      },
      dynamicVariables: {
        dynamicVariablePlaceholders: {
          standing_context: "No stored memories yet.",
        },
      },
    },
    tts: { voiceId: MORPHEUS_VOICE_ID },
    // The SDK's request type demands the *output* tool shape here; the API
    // accepts the input shape (verified live), so bridge the codegen quirk.
  } as unknown as ElevenLabs.ConversationalConfig;

  const existingId = env.ELEVENLABS_AGENT_ID;
  if (existingId) {
    await client.conversationalAi.agents.update(existingId, {
      conversationConfig,
    });
    console.log(`Updated agent ${existingId}`);
  } else {
    const agent = await client.conversationalAi.agents.create({
      name: "Morpheus (Tarik OS)",
      conversationConfig,
    });
    console.log(`Created agent: ${agent.agentId}`);
    console.log(`Add to .env.local and Vercel: ELEVENLABS_AGENT_ID=${agent.agentId}`);
  }
}

main().catch((err) => {
  console.error(err?.body ?? err);
  process.exit(1);
});
