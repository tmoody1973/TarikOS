import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitDuration,
  naiveChicago,
  isoToChicagoNaive,
  isValidDate,
  isValidTime,
} from "../src/lib/calendarLib.ts";

test("splitDuration maps 90 minutes to 1h30m and 60 to 1h0m", () => {
  assert.deepEqual(splitDuration(90), { hours: 1, minutes: 30 });
  assert.deepEqual(splitDuration(60), { hours: 1, minutes: 0 });
  assert.deepEqual(splitDuration(45), { hours: 0, minutes: 45 });
});

test("naiveChicago builds a naive datetime from date and 24h time", () => {
  assert.equal(naiveChicago("2026-08-08", "13:30"), "2026-08-08T13:30:00");
  assert.equal(naiveChicago("2026-08-08", "9:05"), "2026-08-08T09:05:00");
});

test("isoToChicagoNaive renders an offset ISO instant in Chicago wall time", () => {
  // 20:00Z = 15:00 CDT on Aug 8
  assert.equal(isoToChicagoNaive("2026-08-08T20:00:00Z"), "2026-08-08T15:00:00");
  // Already Chicago-offset ISO round-trips to the same wall time
  assert.equal(
    isoToChicagoNaive("2026-08-08T15:00:00-05:00"),
    "2026-08-08T15:00:00",
  );
  // Winter date uses CST (-06:00): 20:00Z = 14:00
  assert.equal(isoToChicagoNaive("2026-01-15T20:00:00Z"), "2026-01-15T14:00:00");
});

test("date and time validators accept good input and reject junk", () => {
  assert.equal(isValidDate("2026-08-08"), true);
  assert.equal(isValidDate("tomorrow"), false);
  assert.equal(isValidTime("13:30"), true);
  assert.equal(isValidTime("9:05"), true);
  assert.equal(isValidTime("25:00"), false);
  assert.equal(isValidTime("noon"), false);
});
