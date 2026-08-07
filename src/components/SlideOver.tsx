"use client";

import { useEffect, useRef } from "react";

// Shared slide-in panel shell (ReaderPane pattern, MOO-487): backdrop,
// Esc/backdrop close, LCARS header cap, optional footer.
export function SlideOver({
  open,
  onClose,
  label,
  accent = "bg-lavender",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  accent?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-panel-edge bg-panel shadow-2xl transition-transform duration-300 motion-reduce:transition-none sm:max-w-xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-3 border-b border-panel-edge px-5 py-3">
          <span className={`lcars-cap-left h-4 w-8 ${accent}`} aria-hidden />
          <span className="truncate text-[10px] uppercase tracking-[0.3em] text-steel">
            {label}
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close panel"
            className="ml-auto rounded-md border border-panel-edge px-2.5 py-1 text-xs text-steel transition hover:border-salmon/50 hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            ✕ ESC
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-7">
          {open ? children : null}
        </div>
        {footer && (
          <footer className="border-t border-panel-edge px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
