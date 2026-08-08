"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SlideOver } from "./SlideOver";

// The Viewport (MOO-485): live query on the latest browserSessions row,
// interactive Browserbase live view in the iframe (clicking it IS takeover).
// Auto-opens when a session starts; closing the panel leaves the session
// running — only END SESSION kills it.

export function ViewportPanel() {
  const session = useQuery(api.browserSessions.latestSession);
  // "Which session did the user dismiss?" is the only local fact — open is
  // derived. New sessions auto-open because their id isn't the dismissed one.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const isActive =
    !!session && session.status !== "done" && session.status !== "error";
  const open = isActive && session.sessionId !== dismissedId;

  async function endSession() {
    if (!session) return;
    setEnding(true);
    try {
      await fetch("/api/browser/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
    } finally {
      setEnding(false);
    }
  }

  if (!session) return null;

  const label =
    session.status === "running"
      ? `Viewport · Zola: ${session.task ?? ""}`.slice(0, 60)
      : session.status === "needs_takeover"
        ? "Viewport · needs you"
        : "Viewport";

  return (
    <>
      {/* Reopen tab when an active session's panel is dismissed */}
      {isActive && !open && (
        <button
          onClick={() => setDismissedId(null)}
          className="fixed right-0 top-1/3 z-40 rounded-l-md border border-r-0 border-cyan-hud/60 bg-panel px-2 py-4 text-[10px] uppercase tracking-[0.25em] text-cyan-hud [writing-mode:vertical-rl]"
        >
          Viewport
        </button>
      )}
      <SlideOver
        open={open}
        onClose={() => setDismissedId(session.sessionId)}
        label={label}
        accent="bg-cyan-hud"
        footer={
          <div className="flex items-center gap-3">
            <button
              onClick={endSession}
              disabled={ending}
              className="rounded-md border border-salmon/70 bg-salmon/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground transition enabled:hover:bg-salmon/25 disabled:opacity-40"
            >
              {ending ? "Ending…" : "End session"}
            </button>
            <span className="text-xs text-steel">
              Closing the panel keeps the session alive; the browser is
              click-through interactive.
            </span>
          </div>
        }
      >
        <div className="flex h-full flex-col gap-2">
          {session.status === "needs_takeover" && (
            <div className="rounded-md border border-amber/70 bg-amber/10 px-3 py-2 text-sm text-foreground">
              Zola hit a wall{session.error ? ` — ${session.error}` : ""}. Take
              the wheel: click into the browser below.
            </div>
          )}
          <iframe
            src={session.liveViewUrl}
            allow="clipboard-read; clipboard-write"
            className="min-h-[70vh] w-full flex-1 rounded-md border border-panel-edge bg-black"
            title="Live browser session"
          />
        </div>
      </SlideOver>
    </>
  );
}
