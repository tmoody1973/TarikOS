"use client";

import { useEffect, useState } from "react";
import { SlideOver } from "./SlideOver";

// Today + Inbox transient panels (MOO-487): glance and dismiss. Read-only
// by design — anything that wants an action deep-links to Gmail.

type CalendarEvent = {
  account: string;
  title: string;
  start: string;
  allDay: boolean;
  location?: string;
};
type Email = {
  account: string;
  from: string;
  subject: string;
  snippet: string;
  threadId?: string;
};

function chicagoTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
      });
}

function gmailLink(email: Email): string {
  if (email.threadId) {
    return `https://mail.google.com/mail/u/0/#inbox/${email.threadId}`;
  }
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(
    `subject:"${email.subject}"`,
  )}`;
}

type FetchState<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "error"; message: string };

function useFetchOnOpen<T>(open: boolean, url: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ phase: "loading" });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ phase: "loading" });
    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setState(
          json.ok
            ? { phase: "ready", data: json as T }
            : { phase: "error", message: json.error ?? "Failed to load." },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error", message: "Failed to load." });
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);
  return state;
}

function PanelStatus({ state }: { state: { phase: string; message?: string } }) {
  if (state.phase === "loading") {
    return (
      <p className="pulse-soft mt-10 text-center text-xs tracking-[0.3em] text-steel">
        SYNCING…
      </p>
    );
  }
  return (
    <p className="mt-10 text-center text-sm text-salmon">⚠️ {state.message}</p>
  );
}

export function TodayPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const state = useFetchOnOpen<{ date: string; events: CalendarEvent[] }>(
    open,
    "/api/panels/calendar",
  );
  return (
    <SlideOver open={open} onClose={onClose} label="Today" accent="bg-hudblue">
      {state.phase !== "ready" ? (
        <PanelStatus state={state} />
      ) : (
        <>
          <h2 className="font-[family-name:var(--font-display)] text-2xl uppercase tracking-[0.06em] text-foreground">
            {new Date(`${state.data.date}T12:00:00`).toLocaleDateString(
              "en-US",
              { weekday: "long", month: "long", day: "numeric" },
            )}
          </h2>
          {state.data.events.length === 0 ? (
            <p className="mt-6 text-sm text-steel">
              Nothing on the calendar today.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {state.data.events.map((e, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-md border border-panel-edge bg-black/30 p-3"
                >
                  <span className="w-20 shrink-0 font-[family-name:var(--font-display)] text-sm text-hudblue">
                    {e.allDay ? "ALL DAY" : chicagoTime(e.start)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground/90">
                      {e.title}
                    </span>
                    <span className="block text-[11px] text-steel">
                      {e.location ? `${e.location} · ` : ""}
                      {e.account}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SlideOver>
  );
}

export function InboxPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const state = useFetchOnOpen<{ emails: Email[] }>(open, "/api/panels/inbox");
  return (
    <SlideOver open={open} onClose={onClose} label="Inbox" accent="bg-salmon">
      {state.phase !== "ready" ? (
        <PanelStatus state={state} />
      ) : state.data.emails.length === 0 ? (
        <p className="mt-6 text-sm text-steel">
          No new primary-inbox email in the last day.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {state.data.emails.map((e, i) => (
            <li key={i}>
              <a
                href={gmailLink(e)}
                target="_blank"
                rel="noreferrer"
                className="group block rounded-md border border-panel-edge bg-black/30 p-3 transition hover:border-salmon/40"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground/90">
                    {e.subject || "(no subject)"}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-steel">
                    {e.account}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-salmon/80">
                  {e.from}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs text-foreground/60">
                  {e.snippet}
                </span>
                <span className="mt-1.5 block text-[10px] tracking-[0.2em] text-steel transition group-hover:text-salmon">
                  OPEN IN GMAIL ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </SlideOver>
  );
}
