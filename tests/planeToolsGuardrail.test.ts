import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Zola's Plane tools, and the rules that keep her useful without being
// dangerous. Two ceremonies, deliberately different: a task is additive and
// reversible so she just does it; a project is structural so she asks first.
//
// Comments are stripped before every scan — a guardrail in this repo passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");
const API = CODE("src/lib/plane.ts");
const PROVISION = readFileSync("scripts/provision-agent.ts", "utf8");

const routeCase = (name: string) =>
  ROUTE.split(`case "${name}":`)[1]?.split("\n    case ")[0] ?? "";

const FIVE = [
  "create_task",
  "find_plane_project",
  "get_project_status",
  "update_task_state",
  "create_plane_project",
];

// ------------------------------------------------------------ they exist

test("all five plane tools have a route", () => {
  for (const name of FIVE) assert.ok(routeCase(name), `${name} has no case`);
});

test("all five plane tools are published to the agent", () => {
  for (const name of FIVE) {
    assert.match(PROVISION, new RegExp(`name: "${name}"`), `${name} is not published`);
  }
});

test("every published plane tool carries the shared secret", () => {
  for (const name of FIVE) {
    const def = PROVISION.split(`name: "${name}"`)[1]?.split("\n  },")[0] ?? "";
    assert.match(def, /x-morpheus-secret/, `${name} is published without the secret`);
  }
});

// -------------------------------------------------- nothing gets deleted

test("the API boundary cannot delete or archive anything", () => {
  // A function that does not exist cannot be reached by a mis-heard sentence.
  // This is the whole reason destructive actions are absent rather than merely
  // unexposed.
  assert.doesNotMatch(API, /export async function (delete|archive|remove)/i);
  assert.doesNotMatch(API, /method: "DELETE"/);
});

test("no plane tool route deletes anything", () => {
  for (const name of FIVE) {
    assert.doesNotMatch(routeCase(name), /delete|archive/i, `${name} reaches a destructive path`);
  }
});

// ----------------------------------------------- the two ceremonies

test("creating a task does not ask permission first", () => {
  // A task is additive and one click to undo. The calendar ritual would cost
  // more than the mistake it prevents, and friction is what sends him back to
  // plane.so.
  const body = routeCase("create_task");
  assert.doesNotMatch(body, /confirmed/, "a task must not be gated behind a confirmation");
  assert.match(body, /createWorkItem\(/, "create_task must actually create");
});

test("creating a project returns a blueprint before it writes", () => {
  const body = routeCase("create_plane_project");
  // Checked through isConfirmed rather than against a literal `true`. The
  // literal version shipped and was unusable: every property in the agent's
  // schema is a string, so the flag arrived as "true", `=== true` never passed,
  // and Tarik was handed the blueprint again no matter what he said.
  assert.match(body, /!isConfirmed\(body\.confirmed\)/, "the first call must be a blueprint");
  const blueprint = body.split("!isConfirmed(body.confirmed)")[1]?.split("\n      }")[0] ?? "";
  assert.ok(blueprint, "there is no blueprint branch");
  assert.doesNotMatch(
    blueprint,
    /createProject\(/,
    "the unconfirmed branch must not create the project",
  );
  assert.match(blueprint, /return \{/, "the blueprint branch must return");
});

test("the persona forbids sending confirmed on the first call", () => {
  const persona = PROVISION.split("export const PERSONA =")[1]?.split("`;")[0] ?? "";
  assert.match(persona, /create_plane_project/, "the persona must describe the project tool");
  assert.match(persona, /blueprint/i, "the persona must describe the blueprint step");
  assert.match(persona, /cannot delete|never delete|You cannot delete/i);
});

test("a blueprint cannot carry an unbounded pile of tasks", () => {
  // The research document's warning made concrete: an agent asked to turn a
  // conversation into work will happily produce forty items nobody reads.
  const body = routeCase("create_plane_project");
  assert.match(body, /MAX_BLUEPRINT_TASKS/, "the task list must be bounded");
});

// ------------------------------------------------------ she never picks

test("an ambiguous project is read back rather than chosen", () => {
  const resolver = ROUTE.split("async function resolvePlaneProject")[1]?.split("\nfunction ")[0] ?? "";
  assert.ok(resolver, "resolvePlaneProject is missing");
  assert.match(resolver, /matches\.length > 1/, "several matches must be handled");
  const ambiguous = resolver.split("matches.length > 1")[1]?.split("\n  }")[0] ?? "";
  assert.match(ambiguous, /Which one\?/, "several matches must end in a question");
});

test("an ambiguous task is read back rather than moved", () => {
  const body = routeCase("update_task_state");
  const ambiguous = body.split("matches.length > 1")[1]?.split("\n      }")[0] ?? "";
  assert.ok(ambiguous.includes("Which one?"), "two matching tasks must end in a question");
  assert.doesNotMatch(ambiguous, /updateWorkItem\(/, "an ambiguous task must not be moved");
});

test("no project named falls back to the configured default", () => {
  // This is what makes 'add calling the bank to my list' one sentence.
  const resolver = ROUTE.split("async function resolvePlaneProject")[1]?.split("\nfunction ")[0] ?? "";
  assert.match(resolver, /planeSettings\.forTools/, "the default project must come from settings");
});

// ------------------------------------------------------- the token

test("the token is read from the environment and never defaulted", () => {
  // A token defaulting to "" produces a 401 that reads like an empty
  // workspace, and 'you have no projects' is a much worse lie than 'Plane is
  // not configured'.
  assert.match(API, /process\.env\.PLANE_API_TOKEN/);
  assert.doesNotMatch(API, /PLANE_API_TOKEN\s*(\|\||\?\?)/, "the token must not have a fallback");
  assert.match(API, /throw new Error\("PLANE_API_TOKEN is not configured"\)/);
});

test("no client component imports the Plane API", () => {
  // The whole reason /projects calls a Next route rather than Plane.
  const pages = ["src/app/projects/page.tsx"];
  for (const path of pages) {
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!source.includes('"use client"')) continue;
    assert.ok(
      !/from "@\/lib\/plane"/.test(source),
      `${path} is a client component and must not import the Plane API`,
    );
  }
});

// ------------------------------------------------------- pagination

test("every list follows the cursor to the end", () => {
  // Plane paginates everything. A caller that reads `results` once gets a
  // truncated list with NO error — work simply missing from the board, which
  // looks exactly like work that was never created.
  const collect = API.split("async function collect")[1]?.split("\nexport ")[0] ?? "";
  assert.ok(collect, "the pagination helper is missing");
  assert.match(collect, /next_cursor/);
  assert.match(collect, /next_page_results/);
  for (const fn of ["listProjects", "listStates", "listWorkItems"]) {
    const body = API.split(`export async function ${fn}`)[1]?.split("\nexport ")[0] ?? "";
    assert.match(body, /collect</, `${fn} must page`);
  }
});

test("a failed request throws rather than returning nothing", () => {
  // An error swallowed into an empty array is the same lie as the missing
  // token: it reads as 'there is no work here'.
  assert.match(API, /if \(!res\.ok\) throw new PlaneError/);
});
