/* Function calls in GPT-Live's Responses delegation arrive inside a
 * `response.event` envelope. The finished call is the inner
 * `response.output_item.done` whose item is a `function_call`; the inner
 * `response.completed` carries `output: []`, so it only tells us the backend
 * has finished emitting. Collect calls per backend response, and when that
 * response completes, run them all, submit every result, then continue.
 *
 * Pure state so it can be tested without a socket. */

export type PendingCall = { callId: string; name: string; arguments: string };

// Keyed by the Live delegation id from the `response.event` envelope. The
// nested output_item.done carries no response id (checked against a live
// session on 2026-09-22), so the envelope is the only key both events share.
export type CallState = Record<string, PendingCall[]>;

export const EMPTY_CALL_STATE: CallState = {};

export type CallReduction = {
  state: CallState;
  // Set only when a backend response has completed with calls to run.
  ready?: PendingCall[];
};

export function reduceCallEvent(
  state: CallState,
  raw: unknown,
  delegationId: string | null | undefined,
): CallReduction {
  const event = raw as {
    type?: string;
    item?: { type?: string; call_id?: string; name?: string; arguments?: string };
  };
  const key = delegationId ?? "current";
  switch (event.type) {
    case "response.output_item.done": {
      const item = event.item;
      if (item?.type !== "function_call" || !item.call_id || !item.name) {
        return { state };
      }
      const call = { callId: item.call_id, name: item.name, arguments: item.arguments ?? "{}" };
      return { state: { ...state, [key]: [...(state[key] ?? []), call] } };
    }
    case "response.completed":
    case "response.incomplete":
    case "response.failed": {
      const { [key]: calls = [], ...rest } = state;
      return calls.length && event.type === "response.completed"
        ? { state: rest, ready: calls }
        : { state: rest };
    }
    default:
      return { state };
  }
}

export function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
