"use client";

import { useState, useEffect, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ReaderPane } from "@/components/ReaderPane";
import { SlideOver } from "@/components/SlideOver";
import { MailThreadPanel } from "@/components/MailThread";
import { ArchiveRail } from "./ArchiveRail";
import {
  isSystemBrief,
  chicagoDateTime,
  BRIEF_STATUS_DOT,
  type BriefSummary,
} from "@/lib/briefArchive";

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
  const [archiveOpen, setArchiveOpen] = useState(false); // mobile drawer
  // navigate_ui "open a specific brief": /briefs?open=<title fragment>
  const openParam = useSearchParams().get("open");
  useEffect(() => {
    if (!openParam || !briefs) return;
    const match = briefs.find((b) =>
      b.title.toLowerCase().includes(openParam.toLowerCase()),
    );
    if (match) setSelectedId(match._id);
  }, [openParam, briefs]);
  // Default to the newest EDITORIAL brief — a 3am consolidation log should
  // never be the page's opening state (MOO-495).
  const defaultId = briefs?.find((b) => !isSystemBrief(b))?._id;
  const activeId = selectedId ?? defaultId ?? briefs?.[0]?._id ?? null;

  function selectBrief(id: string) {
    setSelectedId(id as Id<"briefs">);
    setArchiveOpen(false);
  }
  const brief = useQuery(
    api.workflows.getBrief,
    activeId ? { briefId: activeId } : "skip",
  );
  const runNow = useAction(api.workflowRunner.runNow);
  const [refreshing, setRefreshing] = useState(false);
  const [readerUrl, setReaderUrl] = useState<string | null>(null);
  const [mailThread, setMailThread] = useState<{
    threadId: string;
    account: string;
  } | null>(null);

  // Brief links route by kind (MOO-496): the formatter's sentinel host
  // (tarikos.internal) means "open the mail thread slide-over"; everything
  // else is an article for the reader pane.
  function handleLink(url: string) {
    try {
      const u = new URL(url);
      if (u.hostname === "tarikos.internal") {
        const threadId = u.searchParams.get("thread");
        const account = u.searchParams.get("account");
        if (threadId && account) setMailThread({ threadId, account });
        return;
      }
    } catch {
      // fall through to the reader
    }
    setReaderUrl(url);
  }

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
      {/* Archive Rail (MOO-495) — desktop */}
      <aside className="hidden w-80 shrink-0 flex-col rounded-lg border border-panel-edge bg-panel px-3 py-4 lg:flex">
        {briefs === undefined ? (
          <p className="pulse-soft mt-6 text-center text-xs tracking-[0.3em] text-steel">
            SYNCING…
          </p>
        ) : (
          <ArchiveRail
            briefs={briefs as BriefSummary[]}
            activeId={activeId}
            onSelect={selectBrief}
          />
        )}
      </aside>

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
                  <span>{chicagoDateTime(brief._creationTime)}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${BRIEF_STATUS_DOT[brief.status] ?? "bg-steel"}`}
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
                  <span aria-hidden className="lg:hidden">
                    ·
                  </span>
                  <button
                    onClick={() => setArchiveOpen(true)}
                    className="tracking-[0.25em] text-hudblue transition hover:text-cyan-hud focus-visible:outline-2 focus-visible:outline-cyan-hud lg:hidden"
                  >
                    ☰ ARCHIVE
                  </button>
                </div>
              )}
            </header>

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
                        <Body text={s.body} onLink={handleLink} />
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
      <MailThreadPanel thread={mailThread} onClose={() => setMailThread(null)} />

      {/* Archive drawer — mobile */}
      <div className="lg:hidden">
        <SlideOver
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          label="Archive"
          accent="bg-lavender"
        >
          {briefs === undefined ? (
            <p className="pulse-soft mt-6 text-center text-xs tracking-[0.3em] text-steel">
              SYNCING…
            </p>
          ) : (
            <ArchiveRail
              briefs={briefs as BriefSummary[]}
              activeId={activeId}
              onSelect={selectBrief}
            />
          )}
        </SlideOver>
      </div>
    </div>
  );
}
