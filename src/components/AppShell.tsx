"use client";

import { usePathname } from "next/navigation";
import { Authenticated } from "convex/react";
import { ConversationProvider } from "@elevenlabs/react";
import { NavRail } from "./NavRail";
import { VoiceDock } from "./VoiceDock";

// App chrome (MOO-483): nav rail + persistent voice dock around every page.
// The dock lives here — not in a page — so the WebRTC session survives
// route changes. Sign-in renders bare.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/sign-in")) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 gap-3 p-3 pb-28">
        <NavRail />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <Authenticated>
        <ConversationProvider>
          <VoiceDock />
        </ConversationProvider>
      </Authenticated>
    </div>
  );
}
