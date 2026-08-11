// Generate Composio OAuth links for Tarik's Google accounts.
// Run: node scripts/connect-google.ts [alias] [toolkit...]
//   e.g. node scripts/connect-google.ts work                  (first run)
//        node scripts/connect-google.ts personal              (second account)
//        node scripts/connect-google.ts work googlecontacts   (add one toolkit)
// Prints one URL per toolkit. Open each, sign in with the matching Google
// account, approve. Re-run with a new alias to link another account.
//
// Naming the toolkits matters when adding one to an account that already has
// others: without it this re-authorizes gmail and googlecalendar too, and
// approving those URLs creates a second connected account for a toolkit that
// already had one.
import { readFileSync } from "node:fs";
import { Composio } from "@composio/core";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

export const MORPHEUS_USER_ID = "tarik";

/** Connected when no toolkit is named. These have Composio-managed auth configs. */
const DEFAULT_TOOLKITS = ["gmail", "googlecalendar"];

/**
 * Everything this script can authorize.
 *
 * googlecontacts (MOO-499) is deliberately NOT in the default set: it has no
 * auth config in Composio yet, and including it makes a plain
 * `connect-google.ts work` fail for gmail and calendar too.
 */
const TOOLKITS = [...DEFAULT_TOOLKITS, "googlecontacts"];

async function main() {
  const alias = process.argv[2] ?? "work";
  const asked = process.argv.slice(3);
  const unknown = asked.filter((t) => !TOOLKITS.includes(t));
  if (unknown.length) {
    throw new Error(
      `Unknown toolkit(s): ${unknown.join(", ")}. Known: ${TOOLKITS.join(", ")}`,
    );
  }
  const toolkits = asked.length ? asked : DEFAULT_TOOLKITS;
  const composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });

  const session = await composio.create(MORPHEUS_USER_ID, {
    toolkits,
    multiAccount: { enable: true },
  });

  for (const toolkit of toolkits) {
    const auth = await session.authorize(toolkit, {
      alias: `${alias}-${toolkit}`,
    });
    console.log(`\n[${toolkit}] connect "${alias}" account:\n${auth.redirectUrl}`);
  }
  console.log(
    "\nOpen each URL, approve with the right Google account, then tell Morpheus's builder you're done.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
