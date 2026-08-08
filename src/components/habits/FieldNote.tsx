"use client";

// A short principle from the research, chosen by what the trajectory shows.
// Deliberately not a motivational quote generator — three states, three notes.
export function FieldNote({
  returns,
  logged,
}: {
  returns: number;
  logged: number;
}) {
  const note =
    logged === 0
      ? "A habit isn't active until the cue, the minimum and the confirmation are clear. Start by naming when and where."
      : returns > 0
        ? "Coming back is the skill. The tracker measures return, not perfection — a gap you closed is evidence the system works."
        : "On a hard day, take the two-minute version. Continuity protects the identity; capacity can grow later.";

  return (
    <div className="rounded-lg border border-panel-edge bg-panel p-4">
      <h3 className="mb-2 border-b border-panel-edge pb-2 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
        Field note
      </h3>
      <p className="font-[family-name:var(--font-mono-hud)] text-xs leading-6 text-foreground/85">
        {note}
      </p>
    </div>
  );
}
