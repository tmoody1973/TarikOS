// Generate Composio OAuth links for Tarik's Google accounts.
// Run: node scripts/connect-google.ts [alias]
//   e.g. node scripts/connect-google.ts work      (first run)
//        node scripts/connect-google.ts personal  (second account)
// Prints one URL per toolkit (gmail + googlecalendar). Open each, sign in
// with the matching Google account, approve. Re-run with a new alias to
// link another account.
import { readFileSync } from "node:fs";
import { Composio } from "@composio/core";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

export const MORPHEUS_USER_ID = "tarik";
const TOOLKITS = ["gmail", "googlecalendar"];

async function main() {
  const alias = process.argv[2] ?? "work";
  const composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });

  const session = await composio.create(MORPHEUS_USER_ID, {
    toolkits: TOOLKITS,
    multiAccount: { enable: true },
  });

  for (const toolkit of TOOLKITS) {
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
