import { ReactNode } from "react";

export function Zone({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-64 flex-col overflow-hidden rounded-lg border border-panel-edge bg-panel">
      <header className="flex items-center gap-2 p-3 pb-0">
        <span className={`lcars-cap-left h-4 w-10 ${accent}`} />
        <h2 className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.35em] text-foreground/90">
          {title}
        </h2>
        <span className="ml-auto h-px flex-1 max-w-24 bg-panel-edge" />
        <span className={`lcars-cap-right h-2 w-6 ${accent} opacity-50`} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  );
}

export function ZoneEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-sm italic text-steel">{children}</p>
  );
}
