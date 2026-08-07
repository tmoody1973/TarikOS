// One-time (re-runnable) import of PAI TELOS markdown into Convex telosItems.
// Run: node scripts/import-telos.ts
// Idempotent: exact (kind, text) matches are skipped server-side. Aborts with
// a report when zero items parse — the files ship as empty scaffolds until
// Tarik populates them (voice interview is the primary seed path; see spec).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { parseTelosFile, type TelosFile } from "../convex/telosLib.ts";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const TELOS_DIR = join(homedir(), ".claude", "PAI", "USER", "TELOS");
const FILES: TelosFile[] = [
  "MISSION",
  "GOALS",
  "PROBLEMS",
  "CHALLENGES",
  "STRATEGIES",
];

async function main() {
  const convexUrl = env.NEXT_PUBLIC_CONVEX_URL;
  const secret = env.MORPHEUS_TOOL_SECRET;
  if (!convexUrl || !secret) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL and MORPHEUS_TOOL_SECRET required in .env.local");
  }

  const items: {
    kind: "mission" | "goal" | "problem" | "challenge" | "strategy";
    text: string;
    measurable?: string;
    status: "active" | "deferred" | "done" | "dropped";
  }[] = [];
  const allSkipped: string[] = [];

  for (const file of FILES) {
    let content: string;
    try {
      content = readFileSync(join(TELOS_DIR, `${file}.md`), "utf8");
    } catch {
      console.log(`${file}.md: missing, skipped`);
      continue;
    }
    const { items: parsed, skipped } = parseTelosFile(file, content);
    console.log(`${file}.md: ${parsed.length} item(s), ${skipped.length} placeholder/unparsed line(s)`);
    items.push(
      ...parsed.filter(
        (i): i is (typeof items)[number] => i.kind !== "dimension",
      ),
    );
    allSkipped.push(...skipped.map((s) => `${file}: ${s}`));
  }

  if (allSkipped.length > 0) {
    console.log("\nSkipped lines (placeholders or unparseable):");
    for (const s of allSkipped) console.log(`  ${s}`);
  }

  if (items.length === 0) {
    console.error(
      "\nAborting: zero telos items parsed. The TELOS files appear to still be " +
        "empty scaffolds — populate them, or seed by voice (ask Zola to run the telos interview).",
    );
    process.exit(1);
  }

  const convex = new ConvexHttpClient(convexUrl);
  const res = await convex.mutation(api.telos.importItems, { secret, items });
  console.log(
    `\nImported: ${res.added} new item(s), ${res.skippedExisting} already present.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
