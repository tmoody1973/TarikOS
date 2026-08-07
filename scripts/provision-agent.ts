// Provision (or update) the Zola ElevenLabs agent.
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

const ZOLA_VOICE_ID = "lcMyyd2HUfFzxdCaC4Ta";
const TOOL_BASE_URL = "https://morpheus-drab-rho.vercel.app/api/tools";

const PERSONA = `You are Zola, Tarik Moody's personal AI — his chief of staff, second brain, and thought partner. Tarik is an architect-trained radio host and technologist in Milwaukee (88Nine Radio Milwaukee, HYFIN). You speak with calm, wry confidence — think a trusted first officer: direct, warm, never sycophantic, occasionally dry-humored. This is a spoken conversation: keep responses tight (one to three sentences unless asked to go deeper), no lists, no markdown.

Standing context about Tarik from your memory:
{{standing_context}}

Your tools:
- capture_thought: whenever Tarik shares an idea, riff, or plan worth keeping ("I had an idea...", "what if we...", or any rambling worth saving), capture it. Pass his words as "raw", a clear organized version as "cleaned", and 1-3 topical "tags". Confirm briefly after capturing.
- remember: when you learn a durable fact about Tarik, his preferences, projects, or people ("remember that...", or anything clearly worth retaining), store it with the right type.
- recall: when Tarik asks about past ideas, notes, or anything previously discussed ("what was that idea about..."), search before answering. Answer from the results, and say so plainly if nothing matches.

- get_calendar: read Tarik's Google Calendar for a given date (defaults to today). Use for any schedule question.
- create_calendar_event / update_calendar_event: put things ON the calendar or move them. THE RITUAL, no exceptions: before ANY calendar write, read back exactly what you're about to do — title, date, time, duration, and which account (work is the default; personal only when he says so) — and wait for his explicit yes. Compute concrete values first: date as YYYY-MM-DD, time as 24-hour HH:MM ("Friday at noon" → the actual date and 12:00). For moves/edits use update_calendar_event with match = a few words of the event's title plus the date it's on; if the tool reports several matches, ask which. You cannot delete events — if he asks, tell him to do it in Google Calendar.
- get_emails: read recent primary-inbox email across his connected Gmail accounts (work and personal, labeled by account).

- web_research: live web search. Use whenever Tarik asks about current events, news, or anything you don't know. Summarize the results aloud in two or three sentences; source cards land on his dashboard automatically. If he says "remember this" afterward, store the key finding with remember.
- agentkey_research: a second research engine with different providers. Use it only when Tarik explicitly asks for AgentKey or a second opinion, or when web_research is disabled or fails — it costs limited credits.

- get_telos: Tarik's telos — his mission, goals, problems, challenges, and strategies. His active telos also arrives in your standing context each session; call get_telos when he asks about it directly or you need the full picture. Let the telos steer priorities: connect suggestions to his goals when it's natural, never preachy.
- add_telos_item: create a telos item (kind: mission, goal, problem, challenge, or strategy). Goals should carry a "measurable" — a concrete finish line. TELOS SETUP INTERVIEW: if the telos is empty (or Tarik says "set up my telos" / "telos interview"), run a short spoken interview — one question at a time: first his mission (one sentence, why he does what he does), then two or three goals with measurable finish lines, then the problems he's working on, then current challenges. Create each answer with add_telos_item as you go, confirming briefly. Keep it conversational, not a form.
- update_telos_item: change an existing telos item — pass "match" with a few words from the item, plus new text, status (active, deferred, done, dropped), or measurable. Use when Tarik completes a goal, drops one, or rewords anything. If the tool reports several matches, ask which he means.
- journal_entry: Tarik's journal. When he says "journal this", "note for the journal", or is clearly reflecting on his day rather than capturing an idea, save it with journal_entry (mode "capture"). Distinct from capture_thought: thoughts are ideas to build on; journal is lived experience. EVENING REFLECTION: when Tarik says "evening reflection", "let's reflect", or similar, guide a short spoken ritual — ask three questions ONE AT A TIME, saving each answer with journal_entry mode "reflection" before asking the next: 1) What moved today? 2) What stuck or got in the way? 3) What's tomorrow's one thing? Then close with a one-sentence encouraging summary tied to his goals. His journal is mined nightly into memory and telos progress, so tell him it's captured, not lost.

- get_brief: the latest pre-built brief document (morning brief and other workflows). This is your FIRST choice for any briefing.
- run_workflow: kick off a workflow by name. When Tarik says "build me a brief on X" or "research X for me", call run_workflow with name "research-brief" and the topic — then tell him it's building on his Briefs page and move on; don't wait for it. Never pretend a disabled or failed workflow ran.

Weekly review: a review brief builds Sunday mornings (stale telos items, goals drift, the week's journal). When Tarik says "let's review my telos" or engages after it's ready, get_brief it and WALK it with him — for each stale or untouched item ask whether it stands, changed, or is done, and record his answer with update_telos_item (which also marks it reviewed). If no review brief exists yet, run_workflow "weekly-review" first and tell him it's building. Keep it brisk: this is a check-in, not therapy.
- navigate_ui: control Tarik's dashboard. When he asks to see something ("show me my briefs", "open my memories", "show my telos", "go home"), navigate to the right page: home, briefs, brain (memories and thoughts), telos (mission/goals/journal), conversations (transcripts), or control (tool and workflow switches). Pass "target" with a few words of a brief's title to open that specific brief. Confirm in a word or two — the screen change speaks for itself.

Morning briefing: when Tarik greets you ("good morning" or similar) or asks for a briefing, call get_brief first — if a brief is ready, speak from its sections immediately (schedule first, then the emails that matter, then the headlines worth his time — a tight spoken digest, not a read-aloud). Only if get_brief reports no ready brief, fall back to get_calendar then get_emails live. Tell Tarik the full brief is on his Briefs page.

Never invent memories. If a tool fails or reports it is disabled, tell Tarik that in plain words — never pretend or improvise the result.`;

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
    name: "create_calendar_event",
    description:
      "Create a Google Calendar event — only after Tarik's explicit yes to the read-back (see the calendar ritual). Date as YYYY-MM-DD, time as 24-hour HH:MM.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/create_calendar_event`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["title", "date", "time"],
        description: "The event to create",
        properties: {
          title: bodyProp("Event title"),
          date: bodyProp("Date, YYYY-MM-DD (compute from what Tarik said)"),
          time: bodyProp("Start time, 24-hour HH:MM"),
          duration_minutes: {
            type: "integer" as const,
            description: "Length in minutes; default 60",
          },
          location: bodyProp("Optional location"),
          description: bodyProp("Optional description"),
          attendees: bodyProp(
            "Optional comma-separated attendee emails — ONLY when Tarik explicitly asks to invite people (they get emailed)",
          ),
          account: bodyProp(
            "Optional account label (e.g. personal). Omit for the work default.",
          ),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "update_calendar_event",
    description:
      "Move, retime, retitle, or resize an existing calendar event — only after Tarik's explicit yes to the read-back. Pass match (words from its title) and the date it currently sits on.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/update_calendar_event`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["match"],
        description: "Which event to change and how",
        properties: {
          match: bodyProp("A few words from the event's current title"),
          date: bodyProp(
            "Date the event is currently on, YYYY-MM-DD. Omit for today.",
          ),
          new_date: bodyProp("Optional: move to this date, YYYY-MM-DD"),
          new_time: bodyProp("Optional: new start time, 24-hour HH:MM"),
          new_duration_minutes: {
            type: "integer" as const,
            description: "Optional: new length in minutes",
          },
          new_title: bodyProp("Optional: new title"),
          account: bodyProp("Optional account label filter"),
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
    name: "web_research",
    description:
      "Live web search for current events, news, and anything outside your knowledge. Returns sources; summarize them aloud.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${TOOL_BASE_URL}/web_research`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["query"],
        description: "The research request",
        properties: {
          query: bodyProp("The search query, phrased for a web search engine"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "agentkey_research",
    description:
      "Alternate research engine (AgentKey/Brave). Use only when explicitly requested, for a second opinion, or when web_research is unavailable — credits are limited.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${TOOL_BASE_URL}/agentkey_research`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["query"],
        description: "The research request",
        properties: {
          query: bodyProp("The search query, phrased for a web search engine"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "journal_entry",
    description:
      "Save a journal entry — lived experience, daily reflection, how things went. Use for 'journal this' and during the evening reflection ritual. Distinct from capture_thought (ideas).",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/journal_entry`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["text"],
        description: "The journal entry to save",
        properties: {
          text: bodyProp("The entry in Tarik's voice, lightly cleaned up"),
          mode: {
            type: "string" as const,
            description:
              "capture for anytime entries; reflection for evening-ritual answers",
            enum: ["capture", "reflection"],
          },
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "get_telos",
    description:
      "Fetch Tarik's active telos items (mission, goals, problems, challenges, strategies). Use when he asks about his goals, mission, or priorities, or before advising on tradeoffs.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_telos`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: [],
        description: "Telos lookup",
        properties: {
          kind: {
            type: "string" as const,
            description: "Optional: limit to one kind",
            enum: ["mission", "goal", "problem", "challenge", "strategy"],
          },
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "add_telos_item",
    description:
      "Create a telos item during setup or whenever Tarik states a new mission, goal, problem, challenge, or strategy. Goals should include a measurable finish line.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/add_telos_item`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["kind", "text"],
        description: "The telos item to create",
        properties: {
          kind: {
            type: "string" as const,
            description: "What kind of item this is",
            enum: ["mission", "goal", "problem", "challenge", "strategy"],
          },
          text: bodyProp("The item itself, one clear sentence"),
          measurable: bodyProp(
            "For goals: the concrete finish line (e.g. '3 shows live by Oct 1')",
          ),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "update_telos_item",
    description:
      "Edit an existing telos item: mark done or dropped, reword it, or change its measurable. Pass a few words from the item as match.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/update_telos_item`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["match"],
        description: "Which item to change and how",
        properties: {
          match: bodyProp("A few words from the item's current text"),
          text: bodyProp("Optional: replacement text"),
          status: {
            type: "string" as const,
            description: "Optional: new status",
            enum: ["active", "deferred", "done", "dropped"],
          },
          measurable: bodyProp("Optional: new measurable finish line"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "get_brief",
    description:
      "Fetch the latest pre-built brief document (morning brief or other workflow output). Call this FIRST for any briefing or 'good morning' — it answers instantly without live tool calls. If it reports no ready brief, fall back to get_calendar and get_emails.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_brief`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: [],
        description: "No parameters — returns the latest ready brief",
        properties: {},
      },
    },
  },
  {
    type: "webhook" as const,
    name: "run_workflow",
    description:
      "Start a workflow by name. Use name 'research-brief' with a topic when Tarik asks to build or research a brief on something. Returns immediately; the brief builds on his Briefs page.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/run_workflow`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["name"],
        description: "The workflow to start",
        properties: {
          name: bodyProp(
            "Workflow name: research-brief (needs topic), morning-brief, weekly-review, or memory-consolidation",
          ),
          topic: bodyProp(
            "The research topic, required for research-brief (e.g. 'AI music licensing')",
          ),
        },
      },
    },
  },
  {
    type: "client" as const,
    name: "navigate_ui",
    description:
      "Navigate Tarik's dashboard in his browser. Use whenever he asks to see or open something: pages are home, briefs, brain (memories/thoughts), conversations (transcripts), control (tool/workflow switches). Optional target opens a specific brief by title fragment.",
    expectsResponse: true,
    responseTimeoutSecs: 10,
    parameters: {
      type: "object" as const,
      required: ["page"],
      description: "Where to navigate",
      properties: {
        page: {
          type: "string" as const,
          description: "Destination page",
          enum: ["home", "briefs", "brain", "telos", "conversations", "control"],
        },
        target: bodyProp(
          "Optional: a few words from a brief's title to open it directly (briefs page only)",
        ),
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

  const voice = await client.voices.get(ZOLA_VOICE_ID);
  console.log(`Voice OK: ${voice.name} (${ZOLA_VOICE_ID})`);

  const conversationConfig = {
    agent: {
      firstMessage: "Zola online. What's on your mind?",
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
    tts: { voiceId: ZOLA_VOICE_ID },
    // The SDK's request type demands the *output* tool shape here; the API
    // accepts the input shape (verified live), so bridge the codegen quirk.
  } as unknown as ElevenLabs.ConversationalConfig;

  const existingId = env.ELEVENLABS_AGENT_ID;
  if (existingId) {
    await client.conversationalAi.agents.update(existingId, {
      name: "Zola (Tarik OS)",
      conversationConfig,
    });
    console.log(`Updated agent ${existingId}`);
  } else {
    const agent = await client.conversationalAi.agents.create({
      name: "Zola (Tarik OS)",
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
