"use client";

import { useCallback, useEffect, useState } from "react";
import { Authenticated, AuthLoading } from "convex/react";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { MailTabs } from "@/components/MailTabs";
import { Compose, type ComposePrefill } from "./Compose";
import { extractEmailAddress } from "@/lib/emailAddress";
import {
  MailMessages,
  useMailThread,
  type ThreadMessage,
} from "@/components/MailThread";

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

type DraftRow = {
  draftId: string;
  account: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  threadId?: string;
  messageId?: string;
  bodyHtml?: string;
  zola?: boolean;
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

// Shared three-line row body for thread and draft rows — one place to tweak
// the list typography.
function RowBody({
  top,
  date,
  subject,
  snippet,
  tag,
}: {
  top: string;
  date: string;
  subject: string;
  snippet: string;
  tag: string;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground/90">
          {top}
        </span>
        <span className="shrink-0 text-[10px] tracking-wider text-steel">
          {when(date)}
        </span>
      </div>
      <div className="truncate text-sm text-foreground/75">{subject}</div>
      <div className="truncate text-xs text-steel">
        {snippet}
        <span className="ml-2 text-[9px] uppercase tracking-wider text-lavender/60">
          {tag}
        </span>
      </div>
    </>
  );
}

function MailInner() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ThreadRow | null>(null);
  const messages = useMailThread(open?.threadId, open?.account);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [view, setView] = useState<"inbox" | "drafts">("inbox");
  const [composeOpen, setComposeOpen] = useState(false);
  const [prefill, setPrefill] = useState<ComposePrefill | null>(null);

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

  const loadDrafts = useCallback(async (account: string) => {
    setDrafts(null);
    try {
      const qs = account !== "all" ? `?account=${encodeURIComponent(account)}` : "";
      const res = await fetch(`/api/mail/drafts${qs}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setDrafts(json.drafts);
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    if (view === "drafts") loadDrafts(accountFilter);
    else loadThreads(accountFilter);
  }, [view, accountFilter, loadThreads, loadDrafts]);

  // Open an existing Gmail draft in the editor (MOO-494). Our own drafts
  // carry bodyHtml in the list response; Gmail-authored ones fetch it.
  async function openDraft(d: DraftRow) {
    let bodyHtml = d.bodyHtml ?? "";
    if (!bodyHtml && d.messageId) {
      try {
        const res = await fetch(
          `/api/mail/messages/${encodeURIComponent(d.messageId)}?account=${encodeURIComponent(d.account)}`,
        );
        const json = await res.json();
        if (json.ok) bodyHtml = json.html;
      } catch {
        // Empty editor beats a blocked one — the draft stays intact in Gmail.
      }
    }
    setPrefill({
      to: d.to,
      subject: d.subject === "(no subject)" ? "" : d.subject,
      threadId: d.threadId,
      draftId: d.draftId,
      account: d.account,
      bodyHtml,
    });
    setComposeOpen(true);
  }

  function replyTo(row: ThreadRow, msgs: ThreadMessage[]) {
    const lastFrom = msgs[msgs.length - 1]?.from ?? "";
    const email = extractEmailAddress(lastFrom) ?? "";
    setPrefill({
      to: email,
      subject: row.subject.startsWith("Re:") ? row.subject : `Re: ${row.subject}`,
      threadId: row.threadId,
    });
    setComposeOpen(true);
  }


  return (
    <div className="flex flex-1 gap-3">
      {/* Thread list. Below lg it yields to the reader while a thread is open
          — one column at a time, the way a phone mail client works. At lg both
          panes sit side by side exactly as before. */}
      <div
        className={`w-full flex-col lg:flex lg:w-96 lg:shrink-0 ${
          open ? "hidden lg:flex" : "flex"
        }`}
      >
        <Zone title="Mail" accent="bg-lavender">
          <MailTabs />
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
            <button
              onClick={() => setView(view === "drafts" ? "inbox" : "drafts")}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                view === "drafts"
                  ? "border-lavender/70 bg-lavender/15 text-foreground"
                  : "border-panel-edge text-steel hover:border-lavender/40"
              }`}
            >
              drafts
            </button>
            <button
              onClick={() => {
                setPrefill(null);
                setComposeOpen(true);
              }}
              className="ml-auto rounded-md border border-lavender/60 bg-lavender/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground transition hover:bg-lavender/20"
            >
              + Compose
            </button>
          </div>
          {view === "drafts" ? (
            drafts === null ? (
              <ZoneEmpty>syncing…</ZoneEmpty>
            ) : drafts.length === 0 ? (
              <ZoneEmpty>No drafts in Gmail.</ZoneEmpty>
            ) : (
              <ul className="flex-1 space-y-1 overflow-y-auto">
                {drafts.map((d) => (
                  <li key={d.draftId}>
                    <button
                      onClick={() => openDraft(d)}
                      className="w-full rounded-md border border-panel-edge/60 px-2.5 py-2 text-left transition hover:border-lavender/40 hover:bg-black/30"
                    >
                      <RowBody
                        top={`To: ${d.to || "(no recipient)"}`}
                        date={d.date}
                        subject={d.subject}
                        snippet={d.snippet}
                        tag={d.zola ? `${d.account} · Zola drafted` : `${d.account} · draft`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : error ? (
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
                    onClick={() => setOpen(t)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                      open?.threadId === t.threadId
                        ? "border-lavender/60 bg-lavender/10"
                        : "border-transparent hover:border-panel-edge hover:bg-black/30"
                    }`}
                  >
                    <RowBody
                      top={t.from || "(unknown sender)"}
                      date={t.date}
                      subject={t.subject}
                      snippet={t.snippet}
                      tag={t.account}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Zone>
      </div>

      {/* Reading pane. Was hidden below lg, which meant a phone could list
          mail but never read it. */}
      <main
        className={`min-w-0 flex-1 flex-col lg:flex ${
          open ? "flex" : "hidden"
        }`}
      >
        <Zone title={open ? open.subject : "Reader"} accent="bg-lavender">
          {!open ? (
            <ZoneEmpty>Select a thread to read it here.</ZoneEmpty>
          ) : messages === null ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : messages.length === 0 ? (
            <ZoneEmpty>Couldn&apos;t load that thread.</ZoneEmpty>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                {/* Below lg the list is gone while this is open, so the way
                    back has to be on screen — a reader you can't leave is a
                    trap. At lg the list is still there and this is noise. */}
                <button
                  onClick={() => setOpen(null)}
                  className="rounded-md border border-panel-edge px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-steel transition hover:border-lavender/40 hover:text-foreground motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud lg:hidden"
                >
                  ← Inbox
                </button>
                <button
                  onClick={() => replyTo(open, messages)}
                  className="ml-auto rounded-md border border-lavender/60 bg-lavender/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground transition hover:bg-lavender/20 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud"
                >
                  ↩ Reply
                </button>
              </div>
              <MailMessages messages={messages} />
            </div>
          )}
        </Zone>
      </main>

      <Compose
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        accounts={accounts}
        prefill={prefill}
        onSent={() => {
          if (view === "drafts") loadDrafts(accountFilter);
        }}
      />
    </div>
  );
}
