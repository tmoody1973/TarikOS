"use client";

import { useEffect, useRef, useState } from "react";
import { hostLabel } from "@/lib/hostLabel";

// Slide-in reader pane: server-extracted article text (via /api/reader),
// rendered in the LCARS theme. Iframe embedding was rejected — publishers
// block it with X-Frame-Options/frame-ancestors.

type Article = {
  title: string;
  byline: string | null;
  siteName: string | null;
  html: string;
  excerpt: string | null;
};

type ReaderState =
  | { phase: "loading" }
  | { phase: "ready"; article: Article }
  | { phase: "error"; message: string };

export function ReaderPane({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<ReaderState>({ phase: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = url !== null;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState({ phase: "loading" });
    closeRef.current?.focus();
    fetch(`/api/reader?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setState(
          json.ok
            ? { phase: "ready", article: json.article }
            : { phase: "error", message: json.error ?? "Couldn't read that page." },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({ phase: "error", message: "Couldn't reach the reader." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Pane */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Source reader"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-panel-edge bg-panel shadow-2xl transition-transform duration-300 motion-reduce:transition-none sm:max-w-xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-3 border-b border-panel-edge px-5 py-3">
          <span className="lcars-cap-left h-4 w-8 bg-lavender" aria-hidden />
          <span className="truncate text-[10px] uppercase tracking-[0.3em] text-steel">
            {state.phase === "ready"
              ? (state.article.siteName ?? "Reader")
              : "Reader"}
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close reader"
            className="ml-auto rounded-md border border-panel-edge px-2.5 py-1 text-xs text-steel transition hover:border-salmon/50 hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            ✕ ESC
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-7">
          {!open ? null : state.phase === "loading" ? (
            <p className="pulse-soft mt-10 text-center text-xs tracking-[0.3em] text-steel">
              EXTRACTING…
            </p>
          ) : state.phase === "error" ? (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-salmon">⚠️ {state.message}</p>
              <p className="max-w-xs text-xs leading-6 text-steel">
                Some pages block extraction from a server. Open the original
                below — it loads fine in your browser.
              </p>
              {url && (
                <span className="text-[10px] uppercase tracking-[0.2em] text-steel">
                  {hostLabel(url)}
                </span>
              )}
            </div>
          ) : (
            <article>
              <h2 className="font-[family-name:var(--font-display)] text-2xl uppercase leading-tight tracking-[0.06em] text-foreground [overflow-wrap:anywhere]">
                {state.article.title}
              </h2>
              {state.article.byline && (
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-steel">
                  {state.article.byline}
                </p>
              )}
              <div
                className="reader-prose mt-4"
                dangerouslySetInnerHTML={{ __html: state.article.html }}
              />
            </article>
          )}
        </div>

        {url && (
          <footer className="border-t border-panel-edge px-5 py-3">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="lcars-cap-right inline-block bg-hudblue px-4 py-1.5 font-[family-name:var(--font-display)] text-sm text-black transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-cyan-hud"
            >
              OPEN ORIGINAL ↗
            </a>
          </footer>
        )}
      </aside>
    </>
  );
}
