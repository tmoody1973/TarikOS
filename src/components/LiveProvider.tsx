"use client";

import { createContext, useContext } from "react";
import { DEFAULT_VOICE } from "@/lib/voice/liveSession";
import { useLiveSession, type LiveSession } from "@/lib/voice/useLiveSession";

/* One GPT-Live session for the whole shell, the way ConversationProvider held
 * the ElevenLabs one (MOO-527). The dock starts and stops it; /talk reads it.
 * Mounted above the router so the session survives navigation. */

const LiveContext = createContext<LiveSession | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const session = useLiveSession({ voice: DEFAULT_VOICE });
  return <LiveContext.Provider value={session}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveSession {
  const session = useContext(LiveContext);
  if (!session) throw new Error("useLive must be used inside LiveProvider");
  return session;
}
