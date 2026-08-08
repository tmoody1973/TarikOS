export type ViewportStatus =
  | "idle"
  | "running"
  | "needs_takeover"
  | "done"
  | "error";

/* Should the Viewport panel put itself over the dashboard?
 *
 * "Arrived after mount" is the test rather than a clock: a session the page
 * found already sitting there is history — Browserbase has usually released it,
 * so its live view renders a dead debugger socket. A session that appears while
 * you are watching is something happening now (the VIEW button, or Zola
 * starting a browse), and that earns the screen.
 *
 * needs_takeover is the one exception: she is blocked waiting on a human, so it
 * opens even on a reload. Staleness is handled upstream — latestSession stops
 * returning rows past STALE_MS at all. */
export function shouldAutoOpen({
  status,
  sessionId,
  preexistingId,
}: {
  status: ViewportStatus;
  sessionId: string;
  preexistingId: string | null;
}): boolean {
  if (status === "done" || status === "error") return false;
  if (status === "needs_takeover") return true;
  return sessionId !== preexistingId;
}
