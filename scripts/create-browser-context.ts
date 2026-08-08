import Browserbase from "@browserbasehq/sdk";

/* One-off: create the persistent Browserbase Context that holds the logins
 * Tarik chooses to keep (MOO-503).
 *
 *   node --experimental-strip-types scripts/create-browser-context.ts
 *
 * Print the id, put it in BROWSERBASE_CONTEXT_ID locally and in Vercel, then
 * open the Viewport (VIEW in the rail) and sign in to the sites you want
 * remembered. Browserbase encrypts context data at rest.
 *
 * Only sign into things you would not mind an agent reaching. A context is one
 * browser profile: everything you log into here is reachable by any session
 * that opts in. No code can enforce what you choose to log into — that part is
 * yours. Keep email, banking, and anything holding a card out of it.
 *
 * Leaving BROWSERBASE_CONTEXT_ID unset keeps every session bare, which is the
 * default the rest of the system assumes. */

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
  console.error(
    "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID first (they're in .env.local).",
  );
  process.exit(1);
}

const bb = new Browserbase({ apiKey });
const context = await bb.contexts.create({ projectId });

console.log(`\nContext created.\n\n  BROWSERBASE_CONTEXT_ID=${context.id}\n`);
console.log("Add that to .env.local and to Vercel:");
console.log(
  `  printf %s "${context.id}" | vercel env add BROWSERBASE_CONTEXT_ID production\n`,
);
console.log(
  "Then click VIEW in the rail and sign in to the sites you want remembered.\n",
);

// undici keep-alive holds the process open otherwise (house lesson).
process.exit(0);
