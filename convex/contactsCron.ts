"use node";

import { internalAction } from "./_generated/server";
import { TOOL_BASE_URL } from "./workflowLib";

// The scheduled contact sync (MOO-499).
//
// Calls the tool route rather than doing the work here, the same way the
// workflow runner does: the Composio proxy call and the People mapping live on
// the Next side, and this keeps one implementation rather than a second copy
// inside Convex.

export const sync = internalAction({
  args: {},
  handler: async () => {
    const secret = process.env.MORPHEUS_TOOL_SECRET;
    if (!secret) throw new Error("MORPHEUS_TOOL_SECRET not set in Convex env");

    const res = await fetch(`${TOOL_BASE_URL}/sync_contacts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-morpheus-secret": secret },
      body: JSON.stringify({}),
    });
    const result = (await res.json()) as { ok?: boolean; message?: string };
    // Logged, not thrown: a failed sync must not retry-storm the provider, and
    // the tool's own health record already carries the error for the panel.
    console.log(`contact sync: ${result.ok ? "ok" : "FAILED"} — ${result.message ?? "no message"}`);
  },
});
