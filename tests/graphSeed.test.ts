import { test } from "node:test";
import assert from "node:assert/strict";
import { seedPositions } from "../src/lib/graphLayout.ts";

const NODES = ["alpha", "beta", "gamma", "delta"].map((id) => ({
  id,
  kind: "memory" as const,
  label: id,
  at: 0,
}));

// A force simulation is what makes the graph feel alive — dots push apart, links
// pull, you drag one and the web follows. Its one real cost is that it settles
// somewhere slightly different every time, and then the shape never becomes
// familiar. Seeding the START from the node ids removes that cost: same graph,
// same settle, still alive.

test("the same graph seeds to the same starting positions", () => {
  const a = seedPositions(NODES, 900);
  const b = seedPositions(NODES, 900);
  for (const id of Object.keys(a)) assert.deepEqual(b[id], a[id]);
});

test("node order does not change where a node starts", () => {
  // Convex returns rows newest-first, so one new memory reshuffles the array.
  // If the seed came from the index, one capture would rearrange the whole map.
  const shuffled = [...NODES].reverse();
  const a = seedPositions(NODES, 900);
  const b = seedPositions(shuffled, 900);
  for (const id of Object.keys(a)) assert.deepEqual(b[id], a[id]);
});

test("different nodes do not start stacked on each other", () => {
  const p = seedPositions(NODES, 900);
  const seen = new Set(Object.values(p).map((v) => `${v.x},${v.y}`));
  assert.equal(seen.size, NODES.length);
});

test("seeds land inside the canvas", () => {
  for (const [id, v] of Object.entries(seedPositions(NODES, 900))) {
    assert.ok(v.x >= 0 && v.x <= 900, `${id} x off canvas`);
    assert.ok(v.y >= 0 && v.y <= 900, `${id} y off canvas`);
  }
});
