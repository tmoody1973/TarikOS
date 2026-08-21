"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ZoneEmpty } from "@/components/hud/Zone";

/**
 * The work, and what points at it.
 *
 * PARA's one genuinely load-bearing idea is "organise for actionability, not
 * for subject". This is that idea with the filing removed: every row below is
 * a pointer at a record that already exists, assembled at read time. There is
 * nothing here to sort, approve, tag or tidy — which is the whole difference
 * between a lens and a folder structure.
 *
 * Two strengths of connection, shown differently on purpose. `supports` is a
 * real foreign key. `mentions` is a fact about strings. Neither is a guess,
 * and nothing here was inferred.
 */

const KIND_COLOR: Record<string, string> = {
  goal: "var(--lcars-sage)",
  problem: "var(--lcars-salmon)",
  challenge: "var(--lcars-ochre)",
};

export function BrainFocus() {
  const items = useQuery(api.focus.focus);
  const router = useRouter();

  if (items === undefined) return <ZoneEmpty>reading your telos…</ZoneEmpty>;
  if (items.length === 0) {
    return (
      <ZoneEmpty>
        No active goals, problems or challenges — this page reads your telos, so it
        fills when that does.
      </ZoneEmpty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {items.map((t) => {
        const overdue = t.reviewedDaysAgo > t.cadenceDays;
        return (
          <section key={t.id} className="mb-6 border-b border-panel-edge/50 pb-5 last:border-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className="text-[10px] uppercase tracking-[0.3em]"
                style={{ color: KIND_COLOR[t.kind] ?? "var(--lcars-steel)" }}
              >
                {t.kind}
              </span>
              <span className={`text-[10px] ${overdue ? "text-amber/80" : "text-steel"}`}>
                looked at {t.reviewedDaysAgo}d ago
              </span>
              <button
                onClick={() =>
                  router.push(
                    `/brain?view=graph&focus=${encodeURIComponent(t.text.slice(0, 40))}`,
                  )
                }
                className="ml-auto rounded-full border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-steel transition hover:border-cyan-hud/50 hover:text-foreground"
              >
                map
              </button>
            </div>

            <p className="mt-1 text-base leading-snug text-foreground/90 [overflow-wrap:anywhere]">
              {t.text}
            </p>
            {t.measurable && (
              <p className="mt-0.5 text-xs text-steel [overflow-wrap:anywhere]">{t.measurable}</p>
            )}

            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Pointers label="supported by" tone="strong" rows={t.supports} />
              <Pointers label="decided" tone="weak" rows={t.decisions} />
              <Pointers label="still open" tone="weak" rows={t.loops} />
              <Pointers label="written" tone="weak" rows={t.documents} />
            </div>

            {t.supports.length +
              t.decisions.length +
              t.loops.length +
              t.documents.length ===
              0 && (
              // Stated flatly, with no count and no call to action. Something
              // with nothing pointing at it is information, not a chore.
              <p className="mt-3 text-xs italic text-steel/70">Nothing points at this yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Pointers({
  label,
  tone,
  rows,
}: {
  label: string;
  tone: "strong" | "weak";
  rows: readonly { id: string; label: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-[0.25em] text-steel">
        {label}
        {tone === "weak" && (
          // The honest label. These rows share the goal's words; that is a fact
          // about strings, not a relationship anybody stated.
          <span className="ml-1.5 normal-case tracking-normal text-steel/50">· by wording</span>
        )}
      </h4>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="text-sm text-foreground/75 [overflow-wrap:anywhere]">
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
