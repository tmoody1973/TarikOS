// Responses API function-tool shape, as GPT-Live's delegation.responses.tools
// accepts it. Kept in its own file so the generated list can import a type
// without pulling in anything that reads env at import time.
export type LiveFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
};

/* Tools the browser answers itself, without a round trip to /api/tools.
 * navigate_ui changes the page; end_call closes the session. Both existed
 * before as an ElevenLabs client tool and a system tool. */
export const BROWSER_TOOLS = new Set(["navigate_ui", "end_call"]);
