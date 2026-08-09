"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, isActiveRoute } from "@/lib/navLinks";

// LCARS rail as real navigation (MOO-483). Active page renders full-opacity
// with a glow; others dim until hover.
export function NavRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-40 shrink-0 flex-col gap-2 lg:flex">
      <div className="lcars-cap-left flex h-24 items-end justify-end bg-amber p-3">
        <span className="font-[family-name:var(--font-display)] text-xl leading-none text-black">
          TARIK
          <br />
          OS
        </span>
      </div>
      {/* Viewport (MOO-485): opens a blank Browserbase session; the panel
          slides in via its live query once the row lands. */}
      <button
        onClick={async () => {
          try {
            const res = await fetch("/api/browser/start", { method: "POST" });
            const json = await res.json();
            // Busy case: the reopen tab on the right edge is the way back in.
            if (!json.ok) console.warn("viewport:", json.error);
          } catch {
            console.warn("viewport: start request failed");
          }
        }}
        className="lcars-cap-left flex h-12 items-center justify-end bg-cyan-hud p-3 opacity-50 transition hover:opacity-80"
      >
        <span className="font-[family-name:var(--font-display)] text-sm text-black">
          VIEW
        </span>
      </button>
      {NAV_LINKS.map((l) => {
        const active = isActiveRoute(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`lcars-cap-left flex h-12 items-center justify-end p-3 transition ${l.color} ${
              active ? "opacity-100" : "opacity-50 hover:opacity-80"
            }`}
          >
            <span className="font-[family-name:var(--font-display)] text-sm text-black">
              {l.label}
            </span>
          </Link>
        );
      })}
      <div className="flex flex-1 flex-col justify-end gap-1 rounded-lg border border-panel-edge bg-panel p-3">
        <span className="text-[10px] tracking-[0.3em] text-steel">ZOLA</span>
        <span className="text-[10px] tracking-[0.2em] text-cyan-hud hud-glow">
          SYSTEMS ONLINE
        </span>
      </div>
    </aside>
  );
}
