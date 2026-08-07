"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

export default function BriefsPage() {
  return (
    <>
      <Authenticated>
        <BriefsInner />
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
// optional **bold** spans. Render just that; no markdown lib needed.
function Body({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) =>
        line.startsWith("- ") ? (
          <p key={i} className="pl-3 text-sm text-foreground/80">
            <span className="text-steel">▸ </span>
            <Bold text={line.slice(2)} />
          </p>
        ) : (
          <p key={i} className="text-sm text-foreground/80">
            <Bold text={line} />
          </p>
        ),
      )}
    </div>
  );
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
  const activeId = selectedId ?? briefs?.[0]?._id ?? null;
  const brief = useQuery(
    api.workflows.getBrief,
    activeId ? { briefId: activeId } : "skip",
  );
  const runNow = useAction(api.workflowRunner.runNow);
  const [refreshing, setRefreshing] = useState(false);

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
    <div className="flex flex-1 gap-3 p-3">
      <aside className="hidden w-40 flex-col gap-2 lg:flex">
        <Link
          href="/"
          className="lcars-cap-left flex h-24 items-end justify-end bg-amber p-3 transition hover:opacity-80"
        >
          <span className="font-[family-name:var(--font-display)] text-xl leading-none text-black">
            TARIK
            <br />
            OS
          </span>
        </Link>
        <div className="lcars-cap-left flex h-12 items-center justify-end bg-lavender p-3">
          <span className="font-[family-name:var(--font-display)] text-sm text-black">
            BRIEFS
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-1 rounded-lg border border-panel-edge bg-panel p-3">
          <span className="text-[10px] tracking-[0.3em] text-steel">ZOLA</span>
          <span className="text-[10px] tracking-[0.2em] text-cyan-hud hud-glow">
            LIVING BRIEFS
          </span>
        </div>
      </aside>

      <main className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_2.5fr]">
        <Zone title="Briefs" accent="bg-lavender">
          {briefs === undefined ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : briefs.length === 0 ? (
            <ZoneEmpty>No briefs yet — the morning brief builds weekdays at 7am.</ZoneEmpty>
          ) : (
            <ul className="space-y-1.5 overflow-y-auto">
              {briefs.map((b) => (
                <li key={b._id}>
                  <button
                    onClick={() => setSelectedId(b._id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
                      b._id === activeId
                        ? "border-lavender/60 bg-lavender/10"
                        : "border-panel-edge bg-black/30 hover:border-lavender/30"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[b.status] ?? "bg-steel"}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground/90">
                        {b.title}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-steel">
                        {briefDate(b._creationTime)} · {b.status}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Zone>

        <Zone title={brief?.title ?? "Reader"} accent="bg-hudblue">
          {brief === undefined && activeId ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : !brief ? (
            <ZoneEmpty>Select a brief.</ZoneEmpty>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-3 border-b border-panel-edge pb-2">
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_COLOR[brief.status] ?? "bg-steel"}`}
                />
                <span className="text-[10px] uppercase tracking-[0.25em] text-steel">
                  {brief.status === "building"
                    ? "building — sections appear as steps complete"
                    : `${brief.status} · ${brief.sections.length} section(s)`}
                </span>
                <button
                  onClick={refresh}
                  disabled={refreshing || brief.status === "building"}
                  className="lcars-cap-right ml-auto bg-hudblue px-4 py-1 font-[family-name:var(--font-display)] text-sm text-black transition hover:opacity-80 disabled:opacity-40"
                >
                  {refreshing ? "QUEUED…" : "REFRESH"}
                </button>
              </div>
              <div className="mt-3 flex-1 space-y-5 overflow-y-auto pr-2">
                {brief.sections.length === 0 ? (
                  <ZoneEmpty>
                    {brief.status === "building"
                      ? "Building — first section incoming…"
                      : "No sections."}
                  </ZoneEmpty>
                ) : (
                  brief.sections.map((s, i) => (
                    <section key={i}>
                      <h3
                        className={`text-[11px] uppercase tracking-[0.3em] hud-glow ${
                          s.body.startsWith("⚠️")
                            ? "text-salmon"
                            : "text-hudblue"
                        }`}
                      >
                        {s.heading}
                      </h3>
                      <div className="mt-1.5">
                        <Body text={s.body} />
                      </div>
                      {s.sources.length > 0 && (
                        <p className="mt-1.5 space-x-3 pl-3 text-[11px]">
                          {s.sources.map((src, j) => (
                            <a
                              key={j}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-lavender/80 underline-offset-2 hover:underline"
                            >
                              {src.title}
                            </a>
                          ))}
                        </p>
                      )}
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
        </Zone>
      </main>
    </div>
  );
}
