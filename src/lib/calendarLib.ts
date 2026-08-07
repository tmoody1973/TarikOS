// Pure calendar helpers — no Composio imports — shared by google.ts and tests.
// Composio's Google Calendar actions want NAIVE datetimes (no offset/Z) paired
// with an IANA timezone, and durations split into hour(0-24)/minutes(0-59).

export const CHICAGO_TZ = "America/Chicago";

export function splitDuration(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  // Owns both bounds: 1 minute to 24 hours.
  const clamped = Math.min(24 * 60, Math.max(1, Math.round(totalMinutes)));
  return { hours: Math.floor(clamped / 60), minutes: clamped % 60 };
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

export function isValidTime(time: string): boolean {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/** "2026-08-08" + "9:05" → "2026-08-08T09:05:00" (naive, for Composio). */
export function naiveChicago(date: string, time: string): string {
  const [h, m] = time.split(":");
  return `${date}T${h.padStart(2, "0")}:${m}:00`;
}

/** Render any offset/Z ISO instant as Chicago wall time, naive format. */
export function isoToChicagoNaive(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-CA + hour12:false can render midnight as "24" — normalize.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}
