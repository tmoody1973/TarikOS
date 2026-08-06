const BLOCKS = [
  { label: "OPS", color: "bg-amber" },
  { label: "MEM", color: "bg-lavender" },
  { label: "COM", color: "bg-hudblue" },
  { label: "SYS", color: "bg-salmon" },
];

export function StatusRail() {
  return (
    <aside className="hidden w-40 flex-col gap-2 lg:flex">
      <div className="lcars-cap-left flex h-24 items-end justify-end bg-amber p-3">
        <span className="font-[family-name:var(--font-display)] text-xl leading-none text-black">
          TARIK
          <br />
          OS
        </span>
      </div>
      {BLOCKS.map((b) => (
        <div
          key={b.label}
          className={`lcars-cap-left flex h-12 items-center justify-end p-3 ${b.color} opacity-80`}
        >
          <span className="font-[family-name:var(--font-display)] text-sm text-black">
            {b.label}
          </span>
        </div>
      ))}
      <div className="flex flex-1 flex-col justify-end gap-1 rounded-lg border border-panel-edge bg-panel p-3">
        <span className="text-[10px] tracking-[0.3em] text-steel">MORPHEUS</span>
        <span className="text-[10px] tracking-[0.2em] text-cyan-hud hud-glow">
          FOUNDATION ONLINE
        </span>
        <span className="text-[10px] tracking-[0.2em] text-steel">
          VOICE · STANDBY
        </span>
      </div>
    </aside>
  );
}
