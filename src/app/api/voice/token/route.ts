import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Mints a WebRTC conversation token for the signed-in user's browser session.
export async function GET() {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    return NextResponse.json(
      { error: "ELEVENLABS_AGENT_ID not configured" },
      { status: 500 },
    );
  }

  try {
    const client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    const { token } = await client.conversationalAi.conversations.getWebrtcToken(
      { agentId },
    );
    return NextResponse.json({ token });
  } catch (error) {
    console.error("Failed to mint conversation token:", error);
    return NextResponse.json(
      { error: "Failed to mint conversation token" },
      { status: 502 },
    );
  }
}
