import type { PlaneProject, PlaneState, PlaneWorkItem } from "./planeLib";

// The Plane API boundary. Every Plane URL and field name in this codebase lives
// here — the shape of src/lib/googlePeople.ts, and for the same reason: when a
// provider renames something, exactly one file changes.
//
// Server-only. The token never reaches a browser, so /projects calls a Next
// route rather than Plane directly.
//
// Tarik OS holds NO copy of a project or work item. Plane owns them, this reads
// them live, and there is deliberately no mirror table to drift — the decision
// and its reasoning are in
// docs/superpowers/specs/2026-08-11-tarik-os-plane-projects-design.md.

const BASE = "https://api.plane.so/api/v1";

/**
 * The workspace, in one place.
 *
 * A constant rather than an environment variable: it is not a secret, it is not
 * per-environment, and a slug that can differ between dev and production is a
 * way to write test data into the wrong workspace.
 */
export const WORKSPACE = "moody-and-co";

/** A Plane request that failed, carrying enough to say WHY out loud. */
export class PlaneError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Plane ${status}: ${detail.slice(0, 200)}`);
    this.name = "PlaneError";
  }
}

function token(): string {
  const key = process.env.PLANE_API_TOKEN;
  // Never defaulted. A missing token that falls back to "" produces a 401 that
  // reads like an empty workspace, and "you have no projects" is a much worse
  // lie than "Plane is not configured".
  if (!key) throw new Error("PLANE_API_TOKEN is not configured");
  return key;
}

type Query = Record<string, string | undefined>;

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown; query?: Query },
): Promise<T> {
  const url = new URL(`${BASE}/workspaces/${WORKSPACE}${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      "X-API-Key": token(),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    // Always live. There is no mirror, so a cached read IS the staleness this
    // design exists to avoid.
    cache: "no-store",
  });

  if (!res.ok) throw new PlaneError(res.status, await res.text());
  // 204 on delete; nothing to parse.
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** One page of a cursor-paginated list. */
type Page<T> = { results: T[]; next_cursor?: string; next_page_results?: boolean };

/**
 * Every page, not just the first.
 *
 * Plane paginates everything and a caller that reads `results` once gets a
 * truncated list with no error — work simply missing from a board, which looks
 * like work that was never created.
 *
 * Bounded: a runaway cursor would loop forever against a paginating API, and
 * this is one person's workspace.
 */
async function collect<T>(path: string, query?: Query): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await request<Page<T>>(path, {
      query: { ...query, per_page: "100", cursor },
    });
    out.push(...(res.results ?? []));
    if (!res.next_page_results || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

export async function listProjects(): Promise<PlaneProject[]> {
  return await collect<PlaneProject>("/projects/");
}

export async function listStates(projectId: string): Promise<PlaneState[]> {
  return await collect<PlaneState>(`/projects/${projectId}/states/`);
}

/**
 * A project's work items.
 *
 * The URL says `issues` because that is what Plane's API calls them. Nothing
 * else in this codebase does — see the note in planeLib.ts.
 */
export async function listWorkItems(projectId: string): Promise<PlaneWorkItem[]> {
  return await collect<PlaneWorkItem>(`/projects/${projectId}/issues/`);
}

export async function createWorkItem(
  projectId: string,
  payload: { name: string; description?: string; priority?: string },
): Promise<PlaneWorkItem> {
  return await request<PlaneWorkItem>(`/projects/${projectId}/issues/`, {
    method: "POST",
    body: payload,
  });
}

export async function updateWorkItem(
  projectId: string,
  workItemId: string,
  patch: { state?: string; priority?: string; name?: string },
): Promise<PlaneWorkItem> {
  return await request<PlaneWorkItem>(`/projects/${projectId}/issues/${workItemId}/`, {
    method: "PATCH",
    body: patch,
  });
}

export async function createProject(payload: {
  name: string;
  identifier: string;
  description?: string;
}): Promise<PlaneProject> {
  return await request<PlaneProject>("/projects/", {
    method: "POST",
    body: payload,
  });
}

// Deliberately absent: delete and archive, for projects and work items alike.
// They are the research document's "elevated confirmation" class and nothing in
// this release has a confirmation strong enough to earn them. A function that
// does not exist cannot be called by a mis-heard sentence.
