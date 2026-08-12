import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listProjects, listStates, listWorkItems, createWorkItem, updateWorkItem, PlaneError } from "@/lib/plane";
import { boardColumns, workItemPayload } from "@/lib/planeLib";

// The board's data, and the two writes it can make.
//
// A route rather than the page calling Plane directly, for one reason: the
// token is server-side and must never reach a browser. Clerk-gated like every
// other browser-facing route — this one is not for Zola, who has her own
// secret-gated tools.
//
// Live every time. There is no mirror table by design, so this IS the source
// of truth for what the board shows.

function fail(error: unknown) {
  if (error instanceof PlaneError) {
    // The status travels so the page can say "Plane is not configured" rather
    // than rendering an empty board, which reads as "you have no work".
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Plane request failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("project");
  try {
    const projects = await listProjects();
    if (!projectId) return NextResponse.json({ projects, columns: null });

    const [states, items] = await Promise.all([
      listStates(projectId),
      listWorkItems(projectId),
    ]);
    return NextResponse.json({ projects, columns: boardColumns(states, items) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      project?: string;
      title?: string;
      workItem?: string;
      state?: string;
    };
    if (!body.project) {
      return NextResponse.json({ error: "No project" }, { status: 400 });
    }

    // Moving a card.
    if (body.workItem && body.state) {
      const moved = await updateWorkItem(body.project, body.workItem, { state: body.state });
      return NextResponse.json({ ok: true, workItem: moved });
    }

    // Creating one. Same payload builder as the voice path, so a task typed
    // here and a task spoken to Zola are the same object built the same way.
    const built = workItemPayload({ title: body.title ?? "" });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const created = await createWorkItem(body.project, built.payload);
    return NextResponse.json({ ok: true, workItem: created });
  } catch (error) {
    return fail(error);
  }
}
