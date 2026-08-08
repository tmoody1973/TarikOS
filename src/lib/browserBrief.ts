// Viewport findings → brief sections (MOO-485). Pure: the runner passes in
// everything, including the clock, so this maps deterministically.

export type BriefSection = {
  heading: string;
  body: string;
  tool: string;
  updatedAt: number;
  sources: { title: string; url: string }[];
};

import { hostLabel } from "./hostLabel.ts";

export function browseSections(args: {
  task: string;
  resultMessage: string;
  urls: string[];
  replayUrl: string;
  now: number;
  error?: string;
}): BriefSection[] {
  const sources = [...new Set(args.urls)]
    .filter((u) => /^https?:\/\//.test(u))
    .map((u) => ({ title: hostLabel(u), url: u }));
  const body = args.error
    ? `The browsing task hit a problem: ${args.error}. The replay below shows how far it got.`
    : args.resultMessage;
  return [
    {
      heading: "FINDINGS",
      body,
      tool: "browse",
      updatedAt: args.now,
      sources,
    },
    {
      heading: "SESSION REPLAY",
      body: `Task: ${args.task}`,
      tool: "browse",
      updatedAt: args.now,
      sources: [{ title: "Watch the session replay", url: args.replayUrl }],
    },
  ];
}
