import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

// The Picovoice AccessKey, handed to the browser only after Clerk says who is
// asking.
//
// It has to reach the browser — Porcupine runs on-device and cannot init
// without it — but NEXT_PUBLIC_ would inline it into the JS bundle of a public
// landing page, where anyone could read it and spend Tarik's quota. Behind
// Clerk it is exposed to exactly one signed-in person.
//
// Absent key means absent feature, and the 404 says so: the dock simply never
// offers to arm rather than offering something that throws on click.

export async function GET() {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = process.env.PICOVOICE_ACCESS_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "wake word not configured" }, { status: 404 });
  }

  return NextResponse.json({
    key,
    // A custom "Hey Zola" is a .ppn trained in the Picovoice Console and
    // dropped in public/wake/. Until one exists, Porcupine's built-in "Jarvis"
    // works with no training at all — which is a joke this repo has earned,
    // and more usefully means the whole path is testable before anyone opens
    // the Console.
    keyword: process.env.PICOVOICE_KEYWORD?.trim() || "Jarvis",
  });
}
