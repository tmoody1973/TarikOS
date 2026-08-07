"use client";

import { useState, useEffect, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ReaderPane } from "@/components/ReaderPane";

export default function BriefsPage() {
  return (
    <>
      <Authenticated>
        <Suspense>
          <BriefsInner />
        </Suspense>
      </Authenticated>
      <AuthLoading>
        <div className="flex flex-1 items-center justify-center">
          <p className="pulse-soft font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.3em] text-steel">
            ZOLA · AUTHENTICATING…
          </p>
        </div>
      </AuthLoading>
    </>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ready: "bg-cyan-hud",
  building: "bg-amber pulse-soft",
  error: "bg-salmon",
};

function briefDate(creationTime: number): string {
  return new Date(creationTime).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Brief bodies are markdown our own runner emits: "- " list lines with
// **bold** spans and [headline](url) links. Render just that; no markdown
// lib needed. Links open the reader pane via onLink.
function Body({
  text,
  onLink,
}: {
  text: string;
  onLink: (url: string) => void;
}) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) =>
        line.startsWith("- ") ? (
          <p key={i} className="pl-3 text-sm text-foreground/80">
            <span className="text-steel">▸ </span>
            <Inline text={line.slice(2)} onLink={onLink} />
          </p>
        ) : (
          <p key={i} className="text-sm text-foreground/80">
            <Inline text={line} onLink={onLink} />
          </p>
        ),
      )}
    </div>
  );
}

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function Inline({
  text,
  onLink,
}: {
  text: string;
  onLink: (url: string) => void;
}) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) {
      nodes.push(<Bold key={last} text={text.slice(last, m.index)} />);
    }
    const [, label, url] = m;
    nodes.push(
      <a
        key={m.index}
        href={url}
        onClick={(e) => {
          e.preventDefault();
          onLink(url);
        }}
        className="font-semibold text-lavender underline decoration-lavender/40 underline-offset-2 [overflow-wrap:anywhere] transition hover:text-foreground hover:decoration-lavender focus-visible:outline-2 focus-visible:outline-cyan-hud"
      >
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<Bold key={last} text={text.slice(last)} />);
  }
  return <>{nodes}</>;
}

function Bold({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i % 2 === 1 ? (
            <span className="font-semibold text-foreground">{part}</span>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </>
  );
}

function BriefsInner() {
  const briefs = useQuery(api.workflows.listBriefs);
  const [selectedId, setSelectedId] = useState<Id<"briefs"> | null>(null);
  // navigate_ui "open a specific brief": /briefs?open=<title fragment>
  const openParam = useSearchParams().get("open");
  useEffect(() => {
    if (!openParam || !briefs) return;
    const match = briefs.find((b) =>
      b.title.toLowerCase().includes(openParam.toLowerCase()),
    );
    if (match) setSelectedId(match._id);
  }, [openParam, briefs]);
  const activeId = selectedId ?? briefs?.[0]?._id ?? null;
  const brief = useQuery(
    api.workflows.getBrief,
    activeId ? { briefId: activeId } : "skip",
  );
  const runNow = useAction(api.workflowRunner.runNow);
  const [refreshing, setRefreshing] = useState(false);
  const [readerUrl, setReaderUrl] = useState<string | null>(null);

  async function refresh() {
    if (!brief) return;
    setRefreshing(true);
    try {
      await runNow({ name: brief.workflowName, briefId: brief._id });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-1 gap-3">
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-lg border border-panel-edge bg-panel px-4 py-5 sm:px-8">
        {briefs === undefined ? (
          <p className="pulse-soft mt-8 text-center text-xs tracking-[0.3em] text-steel">
            SYNCING…
          </p>
        ) : briefs.length === 0 ? (
          <p className="mt-8 text-center text-sm text-steel">
            No briefs yet — the morning brief builds weekdays at 7am.
          </p>
        ) : (
          <>
            {/* Masthead */}
            <header className="news-rule-double px-1 py-4 text-center">
              <h1 className="font-[family-name:var(--font-display)] text-3xl uppercase leading-none tracking-[0.08em] text-foreground [overflow-wrap:anywhere] sm:text-5xl">
                {brief?.title ?? "The Daily Brief"}
              </h1>
              {/* Folio line */}
              {brief && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-panel-edge pt-2 text-[10px] uppercase tracking-[0.25em] text-steel">
                  <span>{briefDate(brief._creationTime)}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[brief.status] ?? "bg-steel"}`}
                    />
                    {brief.status === "building"
                      ? "building — sections arriving live"
                      : `${brief.status} · ${brief.sections.length} sections`}
                  </span>
                  <span aria-hidden>·</span>
                  <button
                    onClick={refresh}
                    disabled={refreshing || brief.status === "building"}
                    className="tracking-[0.25em] text-hudblue transition hover:text-cyan-hud focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40"
                  >
                    {refreshing ? "QUEUED…" : "↻ REFRESH"}
                  </button>
                </div>
              )}
            </header>

            {/* Editions strip */}
            <nav
              aria-label="Editions"
              className="mt-3 flex gap-2 overflow-x-auto border-b border-panel-edge pb-3"
            >
              {briefs.map((b) => (
                <button
                  key={b._id}
                  onClick={() => setSelectedId(b._id)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                    b._id === activeId
                      ? "border-lavender/70 bg-lavender/15 text-foreground"
                      : "border-panel-edge text-steel hover:border-lavender/40 hover:text-foreground/80"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[b.status] ?? "bg-steel"}`}
                  />
                  {briefDate(b._creationTime)}
                </button>
              ))}
            </nav>

            {/* Column flow */}
            {!brief ? (
              <p className="pulse-soft mt-8 text-center text-xs tracking-[0.3em] text-steel">
                SYNCING…
              </p>
            ) : brief.sections.length === 0 ? (
              <p className="mt-8 text-center text-sm text-steel">
                {brief.status === "building"
                  ? "Building — first section incoming…"
                  : "No sections."}
              </p>
            ) : (
              <div className="news-columns mt-5">
                {brief.sections.map((s, i) => {
                  const isError = s.body.startsWith("⚠️");
                  return (
                    <section
                      key={i}
                      className={`news-item mb-6 ${
                        isError
                          ? "rounded-md border border-salmon/40 bg-salmon/5 p-3"
                          : ""
                      }`}
                    >
                      <h3
                        className={`border-b pb-1 font-[family-name:var(--font-display)] text-base uppercase tracking-[0.15em] [overflow-wrap:anywhere] ${
                          isError
                            ? "border-salmon/40 text-salmon"
                            : "border-panel-edge text-hudblue"
                        }`}
                      >
                        {isError && (
                          <span className="mr-2 text-[10px] tracking-[0.25em]">
                            CORRECTION
                          </span>
                        )}
                        {s.heading}
                      </h3>
                      <div className="mt-2 text-[13px] leading-relaxed">
                        <Body text={s.body} onLink={setReaderUrl} />
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      <ReaderPane url={readerUrl} onClose={() => setReaderUrl(null)} />
    </div>
  );
}
