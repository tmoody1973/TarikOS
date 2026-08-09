"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, isActiveRoute } from "@/lib/navLinks";

/* Mobile navigation (MOO-525). The desktop rail is hidden below lg, which left
 * phones with no navigation at all — eight destinations, none reachable. This
 * is the same rail collapsed to a 24px edge strip: tap it and the same caps
 * slide out, in the same order, in the same channel colors.
 *
 * Active state follows DESIGN.md § Rail active state — full width AND full
 * saturation, because opacity alone is not a visible difference at AA-legible
 * contrast.
 *
 * The strip is 24px, not the 12px first drawn: measured at 375px, a 12px strip
 * gave a 12px tap target (under WCAG 2.5.8's 24px minimum, on a phone's
 * primary navigation) and left only 2.16px between the active and inactive
 * widths — so colour was carrying the state alone, which is the exact failure
 * the two-channel rule exists to prevent. tests/navShared.test.ts holds the
 * floor. */
export function Spine() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="fixed inset-y-0 left-0 z-30 flex w-6 flex-col gap-[3px] py-2 focus-visible:outline-2 focus-visible:outline-cyan-hud"
      >
        {NAV_LINKS.map((l) => {
          const active = isActiveRoute(pathname, l.href);
          return (
            <span
              key={l.href}
              className={`lcars-cap-right block flex-1 ${l.color} ${
                active ? "w-full" : "w-[82%] saturate-[.45]"
              }`}
            />
          );
        })}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setOpen(false)}
        >
          <nav
            aria-label="Sections"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-40 flex-col gap-2 border-r border-panel-edge bg-panel p-2"
          >
            {NAV_LINKS.map((l) => {
              const active = isActiveRoute(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`lcars-cap-right flex h-12 items-center p-3 transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud ${l.color} ${
                    active ? "w-full" : "w-[82%] saturate-[.45]"
                  }`}
                >
                  <span className="font-[family-name:var(--font-display)] text-sm text-black">
                    {l.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
