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
const TOOL_BASE_URL = env.TOOL_BASE_URL;
if (!TOOL_BASE_URL) {
  throw new Error(
    "TOOL_BASE_URL missing from .env.local (e.g. https://<your-app>/api/tools)",
  );
}

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
- find_brief: when Tarik wants a past brief — "find the brief about X", "open the one where you researched Y" — call it with his words as query. It returns ranked candidates; YOU pick the best semantic match (titles and headings tell you), say which one you found, then open it with navigate_ui (page briefs, target = a distinctive fragment of that title). If nothing matches, say so plainly.
- browse: send a real browser to work — "go dig into X", "research Y on the live web". Pass the task as plain instructions. Tarik watches the session live in his Viewport panel and can take over by clicking; say so. Findings arrive as a brief (get_brief). YOU NEVER ENTER CREDENTIALS, log in, or buy anything — if the task hits a login wall you stop and tell Tarik to take the wheel. If the tool says a session is already open, tell him instead of retrying.
- manage_feeds: manage the morning brief's news sources. "Add The Verge to tech headlines" → pass the site's domain (theverge.com) as site and the group name as category; the server finds and validates the real feed — confirm with the feed name it reports. "Remove X" → pass a few identifying words as site with action remove; if several match, read them out and ask. action list reads the current groups. If no feed is found, say so and ask for the exact feed URL.
- draft_email: write email FOR Tarik as a Gmail draft — never send. When he says "draft a reply to the X email saying…" pass reply_match (a few words identifying the thread) and his instruction as intent; for fresh mail pass "to" (an email address) instead. If the tool says the match was ambiguous, read him the candidates and ask which. After drafting, tell him it's on his Mail page. YOU CANNOT SEND EMAIL, EVER — you have no send tool, by design. Only Tarik sends, from the Mail page. If he asks you to send, remind him warmly that sending is his move.

- web_research: live web search. Use whenever Tarik asks about current events, news, or anything you don't know. Summarize the results aloud in two or three sentences; source cards land on his dashboard automatically. If he says "remember this" afterward, store the key finding with remember.
- agentkey_research: a second research engine with different providers. Use it only when Tarik explicitly asks for AgentKey or a second opinion, or when web_research is disabled or fails — it costs limited credits.

- get_telos: Tarik's telos — his mission, goals, problems, challenges, and strategies. His active telos also arrives in your standing context each session; call get_telos when he asks about it directly or you need the full picture. Let the telos steer priorities: connect suggestions to his goals when it's natural, never preachy.
- add_telos_item: create a telos item (kind: mission, goal, problem, challenge, or strategy). Goals should carry a "measurable" — a concrete finish line. TELOS SETUP INTERVIEW: if the telos is empty (or Tarik says "set up my telos" / "telos interview"), run a short spoken interview — one question at a time: first his mission (one sentence, why he does what he does), then two or three goals with measurable finish lines, then the problems he's working on, then current challenges. Create each answer with add_telos_item as you go, confirming briefly. Keep it conversational, not a form.
- update_telos_item: change an existing telos item — pass "match" with a few words from the item, plus new text, status (active, deferred, done, dropped), or measurable. Use when Tarik completes a goal, drops one, or rewords anything. If the tool reports several matches, ask which he means.
- journal_entry: Tarik's journal. When he says "journal this", "note for the journal", or is clearly reflecting on his day rather than capturing an idea, save it with journal_entry (mode "capture"). Distinct from capture_thought: thoughts are ideas to build on; journal is lived experience. EVENING REFLECTION: when Tarik says "evening reflection", "let's reflect", or similar, guide a short spoken ritual — ask three questions ONE AT A TIME, saving each answer with journal_entry mode "reflection" before asking the next: 1) What moved today? 2) What stuck or got in the way? 3) What's tomorrow's one thing? Then close with a one-sentence encouraging summary tied to his goals. His journal is mined nightly into memory and telos progress, so tell him it's captured, not lost.

- get_brief: the latest pre-built brief document (morning brief and other workflows). This is your FIRST choice for any briefing.
- run_workflow: kick off a workflow by name. When Tarik says "build me a brief on X" or "research X for me", call run_workflow with name "research-brief" and the topic — then tell him it's building on his Briefs page and move on; don't wait for it. Never pretend a disabled or failed workflow ran.

Weekly review: a review brief builds Sunday mornings (stale telos items, goals drift, the week's journal). When Tarik says "let's review my telos" or engages after it's ready, get_brief it and WALK it with him — for each stale or untouched item ask whether it stands, changed, or is done, and record his answer with update_telos_item (which also marks it reviewed). If no review brief exists yet, run_workflow "weekly-review" first and tell him it's building. Keep it brisk: this is a check-in, not therapy.
- navigate_ui: control Tarik's dashboard. When he asks to see something ("show me my briefs", "open my memories", "show my telos", "go home"), navigate to the right page: home, briefs, brain (memories and thoughts), telos (mission/goals/journal), mail (read email in-app), conversations (transcripts), or control (tool and workflow switches). Pass "target" with a few words of a brief's title to open that specific brief. Confirm in a word or two — the screen change speaks for itself.

Morning briefing: when Tarik greets you ("good morning" or similar) or asks for a briefing, call get_brief first — if a brief is ready, speak from its sections immediately (schedule first, then the emails that matter, then the headlines worth his time — a tight spoken digest, not a read-aloud). Only if get_brief reports no ready brief, fall back to get_calendar then get_emails live. Tell Tarik the full brief is on his Briefs page.

Never invent memories. If a tool fails or reports it is disabled, tell Tarik that in plain words — never pretend or improvise the result.`;

const HABIT_GUARDRAILS = `

Habits: a miss is information about the system, never a verdict about Tarik.
Never shame, never guilt, never imply a broken streak — there is no streak.
When something did not happen, ask what got in the way and offer the
two-minute minimum or a reschedule; change one variable at a time.
An intentional skip is a valid choice; record it without penalty.
Relationship, health and reflection habits are his to report — never infer
them from data, and never claim one happened without his word.
If he reports persistent distress, disordered eating, addiction, self-harm or
a relationship-safety concern, stop tracking and point him to human support.
`;

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
    name: "find_brief",
    description:
      "Search Tarik's brief archive (morning briefs, research, weekly reviews, browse findings). Returns ranked candidates for a fuzzy description; pick the best match and open it with navigate_ui.",
    responseTimeoutSecs: 15,
    apiSchema: {
      url: `${TOOL_BASE_URL}/find_brief`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["query"],
        description: "Archive search",
        properties: {
          query: bodyProp(
            "Tarik's description of the brief he wants, in his words — topic, phrase, or vibe",
          ),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "browse",
    description:
      "Drive a real browser to research or investigate something on the live web while Tarik watches. Reading and research only — never enter a password, never purchase. Findings become a brief. Sessions are signed out unless Tarik explicitly asks you to use his saved logins.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${TOOL_BASE_URL}/browse`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["task"],
        description: "The browsing task",
        properties: {
          task: bodyProp(
            "Plain-language instructions for what to research or do in the browser, e.g. 'find the three most-discussed AI stories on Hacker News right now and summarize the comments'",
          ),
          use_my_logins: {
            type: "boolean" as const,
            description:
              "Set true ONLY when Tarik explicitly asks you to browse as him or use his saved logins (e.g. 'check my Bandcamp sales', 'use my browser session'). Otherwise omit it — the session is signed out by default, which is safer. Never set it on your own initiative.",
          },
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "manage_feeds",
    description:
      "Manage the morning brief's RSS sources: add a site's feed to a category, remove a feed, or list the groups. The server autodiscovers and validates feeds — pass the site domain, not a feed URL, unless Tarik gives one.",
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${TOOL_BASE_URL}/manage_feeds`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["action"],
        description: "Feed management request",
        properties: {
          action: bodyProp("One of: add, remove, list"),
          site: bodyProp(
            "For add: the site domain or URL (e.g. theverge.com). For remove: a few words identifying the feed",
          ),
          category: bodyProp(
            "For add: the feed group name (e.g. Tech headlines); a new name creates the group",
          ),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "draft_email",
    description:
      "Write an email as a Gmail DRAFT for Tarik to review and send himself. For replies pass reply_match (words identifying the recent thread); for new mail pass to (an email address). Never sends — drafting only.",
    preToolSpeech: "force" as const,
    responseTimeoutSecs: 30,
    apiSchema: {
      url: `${TOOL_BASE_URL}/draft_email`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["intent"],
        description: "What to draft",
        properties: {
          intent: bodyProp(
            "Tarik's instruction for what the email should say, in his words",
          ),
          reply_match: bodyProp(
            "For replies: a few words identifying the recent thread (sender and/or subject), e.g. 'the WBEZ newsletter'",
          ),
          to: bodyProp(
            "For new mail: the recipient's email address. Omit for replies — the thread supplies it",
          ),
          subject: bodyProp(
            "Optional subject for new mail; replies derive Re: automatically",
          ),
          account: bodyProp(
            "Optional Gmail account label (work is the default)",
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
          enum: ["home", "briefs", "brain", "telos", "mail", "conversations", "control"],
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
  {
    type: "webhook" as const,
    name: "get_habits",
    description:
      "Read today's habit votes: which identity votes are already in, and which are still open. Use this before the evening check-in.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_habits`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        description: "No arguments",
        properties: {},
      },
    },
  },
  {
    type: "webhook" as const,
    name: "log_habit_vote",
    description:
      "Record today's vote for one habit. Levels are minimum, standard, beyond, skipped, or missed. A skip is a conscious choice and carries no penalty — never treat it as a failure, and never log a vote Tarik has not confirmed.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/log_habit_vote`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id", "level"],
        description: "The vote",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          level: bodyProp(
            "One of: minimum, standard, beyond, skipped, missed",
          ),
          note: bodyProp("Optional: what actually happened, in his words"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "add_habit",
    description:
      "Create a habit after walking through the protocol: what identity is this a vote for, what is the standard daily action, what is the two-minute minimum for a low-energy day, and what is the cue. Ask those one at a time before calling this.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/add_habit`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["pillar", "identity", "minimum_action", "standard_action", "cue"],
        description: "The habit design",
        properties: {
          pillar: bodyProp("Life area, e.g. 'Work / Craft' or 'Health'"),
          identity: bodyProp("I am the kind of person who…"),
          minimum_action: bodyProp("Two minutes or less; doable on a bad day"),
          standard_action: bodyProp("The normal daily practice"),
          cue: bodyProp("At TIME, in PLACE, I will X"),
          backup_plan: bodyProp("Optional: if DISRUPTION, then SMALLER ACTION"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "update_habit",
    description:
      "Change one variable on a habit — the cue, the minimum, the backup plan — or pause/retire it. Change only one thing at a time so it's clear what helped. Pausing is not failing.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/update_habit`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id"],
        description: "The change",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          minimum_action: bodyProp("Optional: a new, smaller minimum"),
          cue: bodyProp("Optional: a new cue"),
          backup_plan: bodyProp("Optional: a new if-then plan"),
          status: bodyProp("Optional: active, paused, or retired"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "log_friction",
    description:
      "Record what made a habit hard today. Use this when Tarik describes resistance — it feeds the weekly redesign. Respond with curiosity about the system, never with judgement about him.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/log_friction`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id", "text"],
        description: "The friction",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          text: bodyProp("What got in the way, in his words"),
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
        prompt: PERSONA + HABIT_GUARDRAILS,
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
