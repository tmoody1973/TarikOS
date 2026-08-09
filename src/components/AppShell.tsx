"use client";

import { usePathname } from "next/navigation";
import { Authenticated } from "convex/react";
import { ConversationProvider } from "@elevenlabs/react";
import { NavRail } from "./NavRail";
import { Spine } from "./Spine";
import { VoiceDock } from "./VoiceDock";
import { ViewportPanel } from "./ViewportPanel";
import { ServiceWorker } from "./ServiceWorker";

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

/* ConversationProvider wraps the whole shell, not just the dock (MOO-527).
 * The session already outlived navigation; it just wasn't readable from a
 * page, because a page rendered outside the provider. /talk needs
 * useConversationStatus/Mode/Controls, and those only resolve inside it.
 *
 * Safe to have two consumers: registerCallbacks is an additive listener map,
 * and useConversation() with no arguments registers zero callback keys, so
 * VoiceDock's onMessage keeps firing. Verified in the package source, not
 * assumed. Authenticated still gates exactly what it gated before. */
function AppShellInner({ children }: { children: React.ReactNode }) {
  return (
    <ConversationProvider>
      <div className="flex min-h-screen flex-col">
        <div className="flex flex-1 gap-3 p-3 pb-28">
          <NavRail />
          <Spine />
          {/* pl-7 below lg clears the fixed 24px spine plus a 4px gutter; the
              rail already occupies its own column above lg. */}
          <main className="flex min-w-0 flex-1 flex-col pl-7 lg:pl-0">
            {children}
          </main>
        </div>
        <Authenticated>
          <ServiceWorker />
          <ViewportPanel />
          <VoiceDock />
        </Authenticated>
      </div>
    </ConversationProvider>
  );
}
