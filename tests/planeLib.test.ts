import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardColumns,
  describeStatus,
  isConfirmed,
  rankProjects,
  workItemPayload,
  type PlaneState,
  type PlaneWorkItem,
} from "../src/lib/planeLib.ts";

// Plane's pure logic — everything that can be decided without a network.
//
// The rules here come from the live API, not its documentation. Two of them
// exist because the documentation was wrong or misleading:
//
//   · A state's NAME is customisable per project; its `group` is not. Anything
//     that switches on the name breaks the first time a column is renamed.
//   · `state` is documented as required when creating a work item. It is not —
//     an item created without one lands in the project's default state, which
//     is what makes a title-only voice capture possible at all.

const state = (over: Partial<PlaneState>): PlaneState => ({
  id: "s1",
  name: "Backlog",
  group: "backlog",
  ...over,
});

const item = (over: Partial<PlaneWorkItem>): PlaneWorkItem => ({
  id: "i1",
  name: "something",
  state: "s1",
  state_group: "backlog",
  priority: "none",
  sequence_id: 1,
  target_date: null,
  ...over,
});

// ------------------------------------------------------- creating one

test("a work item needs a name", () => {
  // The API accepts almost anything else as absent. A nameless work item is a
  // row you cannot identify in any list, by voice or on screen.
  const built = workItemPayload({ title: "   " });
  assert.equal(built.ok, false);
});

test("a titled work item carries only what was actually given", () => {
  const built = workItemPayload({ title: "Call the bank" });
  assert.equal(built.ok, true);
  assert.deepEqual(built.ok && built.payload, { name: "Call the bank" });
});

test("no state is sent, so the item lands in the project's default", () => {
  // Verified against the live API: POST with only a name returns 201 and the
  // item sits in Backlog. Sending a state would mean resolving one first —
  // a second round trip in the middle of a spoken sentence.
  const built = workItemPayload({ title: "Call the bank" });
  assert.ok(built.ok && !("state" in built.payload));
});

test("a title is trimmed and capped rather than refused for being long", () => {
  const built = workItemPayload({ title: `  ${"x".repeat(500)}  ` });
  assert.ok(built.ok);
  const name = built.ok ? built.payload.name : "";
  assert.ok(name.length < 500, "an overlong title must be capped");
  assert.ok(!name.startsWith(" "), "a title must be trimmed");
});

test("a description and priority ride along when given", () => {
  const built = workItemPayload({
    title: "Ship the board",
    description: "the /projects page",
    priority: "high",
  });
  assert.ok(built.ok);
  const p = built.ok ? built.payload : {};
  assert.equal(p.description, "the /projects page");
  assert.equal(p.priority, "high");
});

test("a priority Plane does not know is dropped, not sent", () => {
  // Plane rejects the whole request on an unknown priority, so one bad word in
  // a spoken sentence would lose the task entirely.
  const built = workItemPayload({ title: "x", priority: "super urgent" });
  assert.ok(built.ok && !("priority" in built.payload));
});

// ------------------------------------------------------- confirmation

test("the string 'true' confirms, because that is what the agent sends", () => {
  // THE BUG, found by Tarik saying yes and being handed the blueprint again.
  // Every tool property is declared as a string in the agent's schema, so the
  // flag arrives as "true" and a `=== true` test can never pass. She could not
  // confirm at all, no matter what he said.
  assert.equal(isConfirmed("true"), true);
});

test("a real boolean still confirms", () => {
  // The board and any HTTP caller send JSON, where it is a boolean.
  assert.equal(isConfirmed(true), true);
});

test("the words a person actually says confirm", () => {
  for (const said of ["yes", "YES", "go ahead", " true "]) {
    assert.equal(isConfirmed(said), true, `${said} should confirm`);
  }
});

test("absence is not confirmation", () => {
  // The whole point of the blueprint. Anything ambiguous must NOT write.
  for (const value of [undefined, null, "", false, "false", "no", "maybe", 0, {}]) {
    assert.equal(isConfirmed(value), false, `${JSON.stringify(value)} must not confirm`);
  }
});

// ------------------------------------------------------------ the board

const STATES: PlaneState[] = [
  state({ id: "done", name: "Done", group: "completed" }),
  state({ id: "back", name: "Backlog", group: "backlog" }),
  state({ id: "prog", name: "In Progress", group: "started" }),
  state({ id: "todo", name: "Todo", group: "unstarted" }),
  state({ id: "kill", name: "Cancelled", group: "cancelled" }),
];

test("columns run backlog, todo, in progress, done, cancelled", () => {
  // Plane returns states in no useful order. Left-to-right has to mean
  // progress or the board reads as noise.
  const columns = boardColumns(STATES, []);
  assert.deepEqual(
    columns.map((c) => c.group),
    ["backlog", "unstarted", "started", "completed", "cancelled"],
  );
});

test("a work item lands in the column for its group, not its state name", () => {
  // THE rule. Plane lets a project rename Todo to anything; the group survives.
  const renamed = STATES.map((s) =>
    s.group === "unstarted" ? { ...s, name: "Next up" } : s,
  );
  const columns = boardColumns(renamed, [item({ state: "todo", state_group: "unstarted" })]);
  const unstarted = columns.find((c) => c.group === "unstarted");
  assert.equal(unstarted?.items.length, 1, "the renamed column lost its work item");
});

test("a state with no work items is still a column", () => {
  // Otherwise the board's shape changes as work moves through it, and a column
  // you could drop something into disappears when it empties.
  const columns = boardColumns(STATES, [item({ state: "back", state_group: "backlog" })]);
  assert.equal(columns.length, 5);
});

test("two states sharing a group become one column", () => {
  // A project can define several started states. Five columns of one card each
  // is not a board.
  const columns = boardColumns(
    [...STATES, state({ id: "rev", name: "In Review", group: "started" })],
    [
      item({ id: "a", state: "prog", state_group: "started" }),
      item({ id: "b", state: "rev", state_group: "started" }),
    ],
  );
  const started = columns.filter((c) => c.group === "started");
  assert.equal(started.length, 1);
  assert.equal(started[0].items.length, 2);
});

test("a work item whose group is unknown is not silently dropped", () => {
  // Losing work off the board is worse than showing it in the wrong place.
  const columns = boardColumns(STATES, [
    item({ id: "orphan", state: "???", state_group: "triage" as never }),
  ]);
  const all = columns.flatMap((c) => c.items.map((i) => i.id));
  assert.ok(all.includes("orphan"), "a work item disappeared from the board");
});

// --------------------------------------------------------- what she says

test("an empty project is described as empty, not as zeroes", () => {
  const said = describeStatus("Pledge drive", []);
  assert.match(said, /nothing/i);
  assert.doesNotMatch(said, /\b0\b/, "she must not read zeroes aloud");
});

test("the status names what is in flight and what is waiting", () => {
  const said = describeStatus("Pledge drive", [
    item({ id: "a", state_group: "started", name: "Book the venue" }),
    item({ id: "b", state_group: "started", name: "Draft the script" }),
    item({ id: "c", state_group: "backlog", name: "Order the shirts" }),
    item({ id: "d", state_group: "completed", name: "Pick a date" }),
  ]);
  assert.match(said, /2 in progress/i);
  assert.match(said, /Pledge drive/);
});

test("the status is a sentence, not a table", () => {
  // Zola speaks this. Anything with a newline or a pipe reads as machinery.
  const said = describeStatus("Pledge drive", [item({ state_group: "started" })]);
  assert.doesNotMatch(said, /[|\n]/);
});

test("finished work is not counted as outstanding", () => {
  const said = describeStatus("Pledge drive", [
    item({ id: "a", state_group: "completed" }),
    item({ id: "b", state_group: "cancelled" }),
  ]);
  assert.doesNotMatch(said, /in progress/i);
});

// ------------------------------------------------------- which project

test("an exact project name outranks a partial one", () => {
  const ranked = rankProjects(
    [
      { id: "aaa-partial", name: "Pledge drive planning", identifier: "PDP" },
      { id: "zzz-exact", name: "Pledge drive", identifier: "PD" },
    ],
    "pledge drive",
  );
  assert.equal(ranked[0].id, "zzz-exact");
});

test("a project matching none of the words is not offered", () => {
  // The rule contact search learned from real data, and the reason two matches
  // is a question rather than a guess.
  assert.equal(rankProjects([{ id: "a", name: "mkedev", identifier: "MKE" }], "pledge").length, 0);
});

test("a project is findable by its identifier", () => {
  // He says "MOODY" as often as he says the name.
  const ranked = rankProjects([{ id: "a", name: "Moody and Co", identifier: "MOODY" }], "moody");
  assert.equal(ranked.length, 1);
});
