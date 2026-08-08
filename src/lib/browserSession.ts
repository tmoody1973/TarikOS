import Browserbase from "@browserbasehq/sdk";

// Browserbase session lifecycle (MOO-485). Server-only; shapes verified with
// real calls 2026-08-07 (create → RUNNING, debug() → debuggerFullscreenUrl,
// REQUEST_RELEASE → COMPLETED).

function client(): Browserbase {
  return new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
}

function projectId(): string {
  const id = process.env.BROWSERBASE_PROJECT_ID;
  if (!id) throw new Error("BROWSERBASE_PROJECT_ID is not configured");
  return id;
}

export type BrowserSession = {
  sessionId: string;
  liveViewUrl: string;
  replayUrl: string;
};

export function replayUrl(sessionId: string): string {
  return `https://browserbase.com/sessions/${sessionId}`;
}

// v1 guardrail: sessions are always bare — no persisted profile — so there
// is never a stored login the agent could use. A test scans this file to
// keep it that way.
export async function createBrowserSession(): Promise<BrowserSession> {
  const bb = client();
  const session = await bb.sessions.create({ projectId: projectId() });
  const debug = await bb.sessions.debug(session.id);
  return {
    sessionId: session.id,
    liveViewUrl: debug.debuggerFullscreenUrl,
    replayUrl: replayUrl(session.id),
  };
}

export async function endBrowserSession(sessionId: string): Promise<void> {
  await client().sessions.update(sessionId, {
    projectId: projectId(),
    status: "REQUEST_RELEASE",
  });
}
