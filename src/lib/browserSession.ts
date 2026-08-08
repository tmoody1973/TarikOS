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

type SessionOptions = {
  /** Attach the saved-login context. Off unless the caller asks. */
  withLogins?: boolean;
  /** Write this session's browser state back into the context. Only the
   *  session Tarik signs in through should do this — the agent reads the
   *  logins, it does not get to rewrite the profile it borrowed. */
  persist?: boolean;
};

/* Sessions are bare by default: no persisted profile, so there is no stored
 * login for the agent to use. That default is the guardrail, and a test keeps
 * it — `withLogins` must be asked for, never assumed.
 *
 * When BROWSERBASE_CONTEXT_ID is set (see scripts/create-browser-context.ts),
 * a caller may opt into that persistent context: a Browserbase Context holds
 * cookies and localStorage, encrypted at rest, so a login Tarik performs by
 * hand in the Viewport survives into later sessions.
 *
 * Two callers, two postures. The VIEW button is Tarik at his own keyboard, so
 * it gets the context. The `browse` tool is the agent, so it gets the context
 * only when Tarik says to — an agent carrying live cookies across arbitrary
 * pages is a prompt-injection target, and that risk is only worth taking
 * deliberately, per request. */
export async function createBrowserSession(
  { withLogins = false, persist = false }: SessionOptions = {},
): Promise<BrowserSession> {
  const bb = client();
  const contextId = process.env.BROWSERBASE_CONTEXT_ID;
  const useContext = withLogins && !!contextId;
  const session = await bb.sessions.create({
    projectId: projectId(),
    ...(useContext
      ? { browserSettings: { context: { id: contextId, persist } } }
      : {}),
  });
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
