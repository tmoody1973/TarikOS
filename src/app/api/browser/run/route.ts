import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Stagehand } from "@browserbasehq/stagehand";
import { api } from "../../../../../convex/_generated/api";
import { convexServer, requireToolSecret } from "@/lib/convexServer";
import { browseSections } from "@/lib/browserBrief";
import { endBrowserSession, replayUrl } from "@/lib/browserSession";

// Viewport runner (MOO-485). Secret-gated (Clerk-exempt in proxy.ts —
// server-to-server only). Replies 202 immediately; the Stagehand loop runs
// under waitUntil. This route exists as a separate HTTP hop so the loop gets
// ITS OWN duration budget instead of the voice tool route's — do not fold it
// back into the tool route.
export const maxDuration = 300;

// The no-credentials guardrail: the agent is told to stop at auth walls, and
// the runner flips the session to needs_takeover when it reports one. No
// credential ever enters this path (sessions are bare — see browserSession.ts).
const GUARDRAILS = `Rules you must follow:
- NEVER type into password, passcode, or one-time-code fields, and never attempt to log in, sign up, or complete a purchase.
- If the task runs into a login wall, paywall requiring an account, or CAPTCHA, STOP immediately and reply with a message starting with "TAKEOVER:" describing what is blocking you.
- Prefer public pages. Finish with a concise summary of what you found.`;

async function runLoop(sessionId: string, task: string, secret: string) {
  const convex = convexServer();
  const urls: string[] = [];
  let stagehand: Stagehand | null = null;
  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserbaseSessionID: sessionId,
      // pino's worker-thread transport can't resolve inside Vercel's traced
      // bundle ("unable to determine transport target") — measured live.
      disablePino: true,
    });
    await stagehand.init();
    const agent = stagehand.agent({
      model: {
        // claude-sonnet-5 isn't in Browserbase's gateway list (rejected
        // live); sonnet-4-6 is, and provider+apiKey routes our own key.
        modelName: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });
    const result = await agent.execute({
      instruction: `${task}\n\n${GUARDRAILS}`,
      maxSteps: 25,
    });
    // Sources: the session's open pages after the run (Stagehand's page
    // wrapper exposes no navigation events — final URLs are the best-effort).
    for (const p of stagehand.context.pages()) {
      try {
        urls.push(p.url());
      } catch {
        // best-effort only
      }
    }
    const message =
      typeof result?.message === "string" && result.message.trim()
        ? result.message.trim()
        : "The task finished without a summary — check the replay.";
    // The prefix is the protocol, but agents sometimes report the wall in
    // prose (observed live: "redirected to a Google Sign-In page…") — catch
    // that language too so the panel banners and the session stays alive.
    const takeover =
      message.startsWith("TAKEOVER:") ||
      /login wall|sign-?in page|login (page|fields|screen)|CAPTCHA|requires? (an? )?(account|login|password)/i.test(
        message,
      );
    if (takeover) {
      await convex.mutation(api.browserSessions.updateSession, {
        secret,
        sessionId,
        status: "needs_takeover",
        error: message.replace(/^TAKEOVER:\s*/, "").slice(0, 300),
      });
      return; // Session stays alive so Tarik can take the wheel.
    }
    const briefId = await convex.mutation(api.browserSessions.writeBrowseBrief, {
      secret,
      title: `Browse: ${task.slice(0, 80)}`,
      sections: browseSections({
        task,
        resultMessage: message,
        urls,
        replayUrl: replayUrl(sessionId),
        now: Date.now(),
      }),
    });
    await convex.mutation(api.browserSessions.updateSession, {
      secret,
      sessionId,
      status: "done",
      briefId,
    });
    await endBrowserSession(sessionId).catch(() => {});
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("browser run failed:", error);
    // One recovery block: failure brief (status "error" — an operational
    // log for the archive's SYSTEM group, never spoken as an edition,
    // MOO-495) + terminal status + session release. If Convex itself is
    // down, console.error above is the record and the stale-row TTL
    // unwedges the busy guard.
    try {
      const briefId = await convexServer().mutation(
        api.browserSessions.writeBrowseBrief,
        {
          secret,
          title: `Browse: ${task.slice(0, 80)}`,
          status: "error",
          sections: browseSections({
            task,
            resultMessage: "",
            urls,
            replayUrl: replayUrl(sessionId),
            now: Date.now(),
            error: detail,
          }),
        },
      );
      await convexServer().mutation(api.browserSessions.updateSession, {
        secret,
        sessionId,
        status: "error",
        error: detail,
        briefId,
      });
    } catch (writeError) {
      console.error("browser run cleanup failed:", writeError);
    }
    await endBrowserSession(sessionId).catch(() => {});
  } finally {
    await stagehand?.close().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const auth = requireToolSecret(req);
  if ("deny" in auth) return auth.deny;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const task = typeof body.task === "string" ? body.task : "";
  if (!sessionId || !task) {
    return NextResponse.json(
      { ok: false, error: "sessionId and task are required" },
      { status: 400 },
    );
  }
  waitUntil(runLoop(sessionId, task, auth.secret));
  return NextResponse.json({ ok: true }, { status: 202 });
}
