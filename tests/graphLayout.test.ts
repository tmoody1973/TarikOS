import { test } from "node:test";
import assert from "node:assert/strict";
import { neighborhood, layout } from "../src/lib/graphLayout.ts";

const NODES = ["a", "b", "c", "d", "e"].map((id) => ({
  id,
  kind: "memory" as const,
  label: id,
  at: 0,
}));
// a — b — c — d ,  e alone
const EDGES = [
  { from: "a", to: "b", rel: "from" },
  { from: "b", to: "c", rel: "from" },
  { from: "c", to: "d", rel: "from" },
];

test("one hop reaches only what touches the focus", () => {
  const ids = neighborhood(NODES, EDGES, "a", 1).map((n) => n.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
});

test("two hops reaches one step further and stops", () => {
  // The local graph is the working tool precisely because it STOPS. A view that
  // creeps outward one ring at a time is the whole graph with extra steps.
  const ids = neighborhood(NODES, EDGES, "a", 2).map((n) => n.id).sort();
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("edges are followed in both directions", () => {
  // "b was derived from a" is the same line as "a produced b". A graph that
  // only walks the arrow direction shows half the neighbourhood.
  const ids = neighborhood(NODES, EDGES, "d", 1).map((n) => n.id).sort();
  assert.deepEqual(ids, ["c", "d"]);
});

test("a node with no connections is still its own neighbourhood", () => {
  // Never an error and never empty: an unconnected node is a normal thing to
  // look at, not a defect to be reported.
  const ids = neighborhood(NODES, EDGES, "e", 2).map((n) => n.id);
  assert.deepEqual(ids, ["e"]);
});

test("the focus node sits at the centre", () => {
  const pos = layout(NODES, EDGES, "a", 400);
  assert.equal(pos.get("a")?.x, 200);
  assert.equal(pos.get("a")?.y, 200);
});

test("every node gets a position inside the canvas", () => {
  const pos = layout(NODES, EDGES, null, 400);
  assert.equal(pos.size, NODES.length);
  for (const [id, p] of pos) {
    assert.ok(p.x >= 0 && p.x <= 400, `${id} x off canvas: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 400, `${id} y off canvas: ${p.y}`);
  }
});

test("the same graph lays out the same way twice", () => {
  // No physics and no randomness, deliberately. A layout that shuffles on every
  // render destroys the only thing a graph is actually good at — recognising
  // the same shape again.
  const a = layout(NODES, EDGES, null, 400);
  const b = layout(NODES, EDGES, null, 400);
  for (const [id, p] of a) assert.deepEqual(b.get(id), p);
});
