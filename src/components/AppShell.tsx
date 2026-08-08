"use client";

import { usePathname } from "next/navigation";
import { Authenticated } from "convex/react";
import { ConversationProvider } from "@elevenlabs/react";
import { NavRail } from "./NavRail";
import { VoiceDock } from "./VoiceDock";
import { ViewportPanel } from "./ViewportPanel";

// App chrome (MOO-483): nav rail + persistent voice dock around every page.
// The dock lives here — not in a page — so the WebRTC session survives
// route changes. Sign-in renders bare; so does the signed-out landing, whose
// `signedIn` comes from the server so the page ships fully rendered (MOO-500).
export function AppShell({
  children,
  signedIn,
}: {
  children: React.ReactNode;
  signedIn: boolean;
}) {
  const pathname = usePathname();
  if (!signedIn || pathname.startsWith("/sign-in")) return <>{children}</>;
  return <AppShellInner>{children}</AppShellInner>;
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 gap-3 p-3 pb-28">
        <NavRail />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <Authenticated>
        <ViewportPanel />
        <ConversationProvider>
          <VoiceDock />
        </ConversationProvider>
      </Authenticated>
    </div>
  );
}
