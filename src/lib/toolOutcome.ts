// A tool call's real outcome, independent of the `ok` flag Zola speaks from.
//
// Four sites in the tool route return `ok: true` for a non-result ("no timed
// event matching…", "several items match…", "no pre-built brief is ready"),
// and a disabled tool returns HTTP 200. Recording those as successes would
// corrupt any eval built on this data — "she called update_telos_item and
// nothing matched" is not a successful tool call.
//
// `ok` and `message` are what the agent reacts to and speaks from, so they are
// left untouched. Callers tag the real outcome on a separate optional field
// that is stripped before the response is serialized.

export const TOOL_OUTCOMES = [
  "success",
  "no_match",
  "ambiguous",
  "disabled",
  "error",
] as const;

export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export function classifyOutcome(result: {
  ok: boolean;
  outcome?: ToolOutcome;
}): ToolOutcome {
  if (result.outcome) return result.outcome;
  return result.ok ? "success" : "error";
}
