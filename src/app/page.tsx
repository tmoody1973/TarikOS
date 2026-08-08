import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { Landing } from "@/components/landing/Landing";
import { HomeDashboard } from "./HomeDashboard";

const PITCH =
  "A personal AI operating system you talk to. Zola reads mail, works the " +
  "calendar, runs research and delivers a morning brief — open source, MIT.";

export const metadata: Metadata = {
  title: "Tarik OS — talk to Zola",
  description: PITCH,
  openGraph: {
    title: "Tarik OS — talk to Zola",
    description: PITCH,
    type: "website",
  },
};

// Server-side fork (MOO-500): signed-out visitors get the public landing,
// fully rendered on the server so crawlers, link previews and no-JS clients
// see the real page. Signed-in owners get the HUD as before.
export default async function Home() {
  const { isAuthenticated } = await auth();
  return isAuthenticated ? <HomeDashboard /> : <Landing />;
}
