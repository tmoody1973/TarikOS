"use client";

import { useCallback, useEffect, useState } from "react";
import { Authenticated, AuthLoading } from "convex/react";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

// Mail page (MOO-492): thread list + sanitized reading pane. Compose lands
// in MOO-493; Zola drafts in MOO-494. Layout is the shadcn Mail three-pane
// shape rebuilt in LCARS.

type ThreadRow = {
  threadId: string;
  account: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

type Message = {
  from: string;
  to: string;
  date: string;
  subject: string;
  html: string;
  sanitizerFallback: boolean;
};

function when(raw: string): string {
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (isNaN(ms)) return "";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MailPage() {
  return (
    <>
      <Authenticated>
        <MailInner />
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

function MailInner() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ThreadRow | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);

  const loadThreads = useCallback(async (account: string) => {
    setThreads(null);
    setError(null);
    try {
      const qs = account !== "all" ? `?account=${encodeURIComponent(account)}` : "";
      const res = await fetch(`/api/mail/threads${qs}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setThreads(json.threads);
      setAccounts(json.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mailbox unavailable.");
      setThreads([]);
    }
  }, []);

  useEffect(() => {
    loadThreads(accountFilter);
  }, [accountFilter, loadThreads]);

  async function openThread(row: ThreadRow) {
    setOpen(row);
    setMessages(null);
    try {
      const res = await fetch(
        `/api/mail/threads/${encodeURIComponent(row.threadId)}?account=${encodeURIComponent(row.account)}`,
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setMessages(json.messages);
    } catch {
      setMessages([]);
    }
  }

  return (
    <div className="flex flex-1 gap-3">
      {/* Thread list */}
      <div className="flex w-full flex-col lg:w-96 lg:shrink-0">
        <Zone title="Mail" accent="bg-lavender">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {["all", ...accounts].map((a) => (
              <button
                key={a}
                onClick={() => setAccountFilter(a)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                  accountFilter === a
                    ? "border-lavender/70 bg-lavender/15 text-foreground"
                    : "border-panel-edge text-steel hover:border-lavender/40"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          {error ? (
            <ZoneEmpty>{error}</ZoneEmpty>
          ) : threads === null ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : threads.length === 0 ? (
            <ZoneEmpty>Inbox is quiet — nothing in the last week.</ZoneEmpty>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto">
              {threads.map((t) => (
                <li key={`${t.account}:${t.threadId}`}>
                  <button
                    onClick={() => openThread(t)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                      open?.threadId === t.threadId
                        ? "border-lavender/60 bg-lavender/10"
                        : "border-transparent hover:border-panel-edge hover:bg-black/30"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground/90">
                        {t.from || "(unknown sender)"}
                      </span>
                      <span className="shrink-0 text-[10px] tracking-wider text-steel">
                        {when(t.date)}
                      </span>
                    </div>
                    <div className="truncate text-sm text-foreground/75">
                      {t.subject}
                    </div>
                    <div className="truncate text-xs text-steel">
                      {t.snippet}
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-lavender/60">
                        {t.account}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Zone>
      </div>

      {/* Reading pane */}
      <main className="hidden min-w-0 flex-1 flex-col lg:flex">
        <Zone title={open ? open.subject : "Reader"} accent="bg-lavender">
          {!open ? (
            <ZoneEmpty>Select a thread to read it here.</ZoneEmpty>
          ) : messages === null ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : messages.length === 0 ? (
            <ZoneEmpty>Couldn't load that thread.</ZoneEmpty>
          ) : (
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {messages.map((m, i) => (
                <article
                  key={i}
                  className="rounded-md border border-panel-edge bg-black/20"
                >
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-panel-edge px-3 py-2">
                    <span className="text-sm font-semibold text-foreground/90">
                      {m.from}
                    </span>
                    <span className="text-[10px] tracking-wider text-steel">
                      {when(m.date)}
                      {m.sanitizerFallback && " · shown as plain text"}
                    </span>
                  </header>
                  {/* Sanitized server-side; sandbox blocks scripts/navigation. */}
                  <iframe
                    sandbox=""
                    srcDoc={`<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#111;background:#fff;margin:12px}</style>${m.html}`}
                    className="h-[60vh] w-full rounded-b-md bg-white"
                    title={`Message from ${m.from}`}
                  />
                </article>
              ))}
            </div>
          )}
        </Zone>
      </main>
    </div>
  );
}
