"use client";

// A blocky heatmap of levels. There is deliberately no streak number here —
// the figure worth showing is how often practice resumed after a gap.
const LEVEL_COLOR: Record<string, string> = {
  minimum: "bg-sage/40",
  standard: "bg-sage/70",
  beyond: "bg-sage",
  skipped: "bg-steel/40",
  missed: "bg-salmon/40",
};

export function TrajectoryStrip({
  series,
  summary,
}: {
  series: { date: string; level: string | null }[];
  summary: { logged: number; returns: number; longestGap: number };
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {series.map((d) => (
          <span
            key={d.date}
            title={`${d.date}${d.level ? ` · ${d.level}` : ""}`}
            className={`h-3 w-3 rounded-[2px] ${
              d.level ? LEVEL_COLOR[d.level] : "bg-panel-edge"
            }`}
          />
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-steel">
        {summary.logged} logged · came back {summary.returns}× · longest gap{" "}
        {summary.longestGap}d
      </p>
    </div>
  );
}
