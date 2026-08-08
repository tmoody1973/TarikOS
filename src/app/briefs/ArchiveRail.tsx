"use client";

import { useMemo, useRef, useState } from "react";
import {
  briefKind,
  splitBriefs,
  groupBriefsByDay,
  chicagoDayKey,
  rankBriefs,
  BRIEF_STATUS_DOT,
  EDITORIAL_KINDS,
  type BriefSummary,
} from "@/lib/briefArchive";

// The briefs Archive Rail (MOO-495): day-grouped vertical list with kind
// badges, instant search, and a fold-out month grid whose dots mark days
// that have editions. Operational logs (consolidation, errored runs) sit in
// a collapsed SYSTEM group at the bottom.

function rowTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase()
    .replace(" ", "");
}

function Row({
  brief,
  active,
  onSelect,
}: {
  brief: BriefSummary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const kind = briefKind(brief.workflowName);
  return (
    <li>
      <button
        onClick={() => onSelect(brief._id)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
          active
            ? "border-lavender/60 bg-lavender/10"
            : "border-transparent hover:border-panel-edge hover:bg-black/30"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${BRIEF_STATUS_DOT[brief.status] ?? "bg-steel"}`}
        />
        <span className="shrink-0 font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.15em] text-hudblue">
          {kind.symbol} {kind.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
          {brief.title}
        </span>
        <span className="shrink-0 text-[10px] tracking-wider text-steel">
          {rowTime(brief._creationTime)}
        </span>
      </button>
    </li>
  );
}

function MonthGrid({
  briefDays,
  onJump,
}: {
  briefDays: Set<string>;
  onJump: (dayKey: string) => void;
}) {
  // ponytail: grid keys use browser-local month math while briefDays are
  // Chicago day keys — identical for a Chicago-based user; revisit if the
  // app ever travels timezones.
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const todayKey = chicagoDayKey(Date.now());

  return (
    <div className="rounded-md border border-panel-edge bg-black/20 p-2.5">
      <div className="flex items-center justify-between pb-2">
        <button
          onClick={() => setMonthStart(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="rounded px-1.5 text-steel transition hover:text-cyan-hud focus-visible:outline-2 focus-visible:outline-cyan-hud"
        >
          ‹
        </button>
        <span className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.25em] text-foreground/80">
          {monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => setMonthStart(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="rounded px-1.5 text-steel transition hover:text-cyan-hud focus-visible:outline-2 focus-visible:outline-cyan-hud"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="text-[9px] text-steel">
            {d}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const has = briefDays.has(key);
          const isToday = key === todayKey;
          // Today is always clickable even before its first edition lands
          // (4am gap: consolidation is SYSTEM, morning brief comes at 7).
          const clickable = has || isToday;
          return (
            <button
              key={key}
              onClick={() => clickable && onJump(key)}
              disabled={!clickable}
              className={`relative rounded py-0.5 text-[10px] transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                clickable
                  ? "text-foreground hover:bg-lavender/15"
                  : "text-steel/50"
              } ${isToday ? "border border-cyan-hud/50" : ""}`}
            >
              {day}
              {has && (
                <span className="absolute inset-x-0 bottom-0 mx-auto h-0.5 w-0.5 rounded-full bg-lavender" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ArchiveRail({
  briefs,
  activeId,
  onSelect,
}: {
  briefs: BriefSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { editorial, system } = useMemo(() => splitBriefs(briefs), [briefs]);
  const filtered = useMemo(
    () =>
      kindFilter === "all"
        ? editorial
        : editorial.filter((b) => briefKind(b.workflowName).key === kindFilter),
    [editorial, kindFilter],
  );
  const groups = useMemo(
    () => groupBriefsByDay(filtered, Date.now()),
    [filtered],
  );
  const briefDays = useMemo(
    () => new Set(groups.map((g) => g.key)),
    [groups],
  );

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!searching) return [];
    const pool =
      kindFilter === "all"
        ? briefs
        : briefs.filter((b) => briefKind(b.workflowName).key === kindFilter);
    return rankBriefs(pool, query, 20);
  }, [briefs, query, searching, kindFilter]);

  function jumpToDay(dayKey: string) {
    setCalendarOpen(false);
    setQuery("");
    const target = scrollRef.current?.querySelector(`[data-day="${dayKey}"]`);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      // No group for that day yet (today before the first edition) — the
      // newest content is at the top.
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* Search + calendar toggle */}
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the archive…"
          aria-label="Search briefs"
          className="min-w-0 flex-1 rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-lavender/50"
        />
        <button
          onClick={() => setCalendarOpen((v) => !v)}
          aria-expanded={calendarOpen}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.15em] transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
            calendarOpen
              ? "border-cyan-hud/60 bg-cyan-hud/10 text-foreground"
              : "border-panel-edge text-steel hover:border-cyan-hud/40 hover:text-foreground/80"
          }`}
        >
          <span aria-hidden>▦</span> DATE
        </button>
      </div>

      {/* Kind filter */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
        {[{ key: "all", label: "ALL", symbol: "" }, ...EDITORIAL_KINDS].map(
          (k) => (
            <button
              key={k.key}
              onClick={() => setKindFilter(k.key)}
              aria-pressed={kindFilter === k.key}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                kindFilter === k.key
                  ? "border-lavender/70 bg-lavender/15 text-foreground"
                  : "border-panel-edge text-steel hover:border-lavender/40 hover:text-foreground/80"
              }`}
            >
              {k.symbol ? `${k.symbol} ${k.label}` : k.label}
            </button>
          ),
        )}
      </div>

      {calendarOpen && <MonthGrid briefDays={briefDays} onJump={jumpToDay} />}

      {/* The archive */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {searching ? (
          results.length === 0 ? (
            <p className="mt-6 text-center text-xs text-steel">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((b) => (
                <Row
                  key={b._id}
                  brief={b}
                  active={b._id === activeId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} data-day={g.key} className="mb-3">
                <h3 className="sticky top-0 z-10 border-b border-panel-edge bg-panel py-1 font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.3em] text-steel">
                  {g.label}
                </h3>
                <ul className="mt-1 space-y-1">
                  {g.briefs.map((b) => (
                    <Row
                      key={b._id}
                      brief={b}
                      active={b._id === activeId}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {system.length > 0 && (
              <section className="mt-4 border-t border-panel-edge pt-2">
                <button
                  onClick={() => setSystemOpen((v) => !v)}
                  aria-expanded={systemOpen}
                  className="flex w-full items-center gap-2 py-1 font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.3em] text-steel transition hover:text-foreground/70 focus-visible:outline-2 focus-visible:outline-cyan-hud"
                >
                  <span aria-hidden>{systemOpen ? "▾" : "▸"}</span>
                  SYSTEM · {system.length}
                </button>
                {systemOpen && (
                  <ul className="mt-1 space-y-1 opacity-70">
                    {system.map((b) => (
                      <Row
                        key={b._id}
                        brief={b}
                        active={b._id === activeId}
                        onSelect={onSelect}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
