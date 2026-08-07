import Link from "next/link";

const BLOCKS: { label: string; color: string; href?: string }[] = [
  { label: "BRIEFS", color: "bg-lavender", href: "/briefs" },
  { label: "OPS", color: "bg-amber" },
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
      {BLOCKS.map((b) => {
        const block = (
          <div
            key={b.label}
            className={`lcars-cap-left flex h-12 items-center justify-end p-3 ${b.color} ${
              b.href ? "transition hover:opacity-100" : ""
            } opacity-80`}
          >
            <span className="font-[family-name:var(--font-display)] text-sm text-black">
              {b.label}
            </span>
          </div>
        );
        return b.href ? (
          <Link key={b.label} href={b.href}>
            {block}
          </Link>
        ) : (
          block
        );
      })}
      <div className="flex flex-1 flex-col justify-end gap-1 rounded-lg border border-panel-edge bg-panel p-3">
        <span className="text-[10px] tracking-[0.3em] text-steel">ZOLA</span>
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
