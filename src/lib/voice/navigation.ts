/* Where Zola can send the dashboard, and what she says when she does.
 * Pure, so both the GPT-Live hook and VoiceDock (until phase 2 retires its
 * copy) resolve navigate_ui the same way. The page names must match the
 * navigate_ui enum in scripts/provision-agent.ts. */

export const PAGES: Record<string, string> = {
  home: "/",
  briefs: "/briefs",
  brain: "/brain",
  // The graph lives inside /brain: a second way of looking at the same store.
  graph: "/brain?view=graph",
  telos: "/telos",
  mail: "/mail",
  habits: "/habits",
  conversations: "/conversations",
  control: "/control",
  talk: "/talk",
};

export type Navigation = { path: string | null; message: string };

export function resolveNavigation({
  page,
  target,
}: {
  page?: string;
  target?: string;
}): Navigation {
  const path = PAGES[page ?? ""];
  if (!path) {
    return {
      path: null,
      message: `Unknown page "${page}". Valid pages: ${Object.keys(PAGES).join(", ")}.`,
    };
  }
  if (page === "briefs" && target) {
    return {
      path: `/briefs?open=${encodeURIComponent(target)}`,
      message: `Opened the brief matching "${target}".`,
    };
  }
  // Focusing the graph on a node lets her answer and put the thing on screen
  // in the same breath.
  if (page === "graph" && target) {
    return {
      path: `/brain?view=graph&focus=${encodeURIComponent(target)}`,
      message: `Focused the graph on "${target}".`,
    };
  }
  return { path, message: `Navigated to ${page}.` };
}
