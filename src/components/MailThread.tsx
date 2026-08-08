"use client";

import { useEffect, useState } from "react";
import { SlideOver } from "./SlideOver";
import { Compose, type ComposePrefill } from "@/app/mail/Compose";
import { extractEmailAddress } from "@/lib/emailAddress";

// Shared mail-thread rendering (MOO-496): one implementation of "fetch a
// sanitized thread and show it" for the /mail reading pane and the briefs
// inbox slide-over. Reply rides the existing Compose (draft-first, explicit
// send — the guardrails don't change by surface).

export type ThreadMessage = {
  from: string;
  to: string;
  date: string;
  subject: string;
  html: string;
  sanitizerFallback: boolean;
};

export function threadWhen(raw: string): string {
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

// null = loading, [] = failed/empty.
export function useMailThread(
  threadId: string | undefined,
  account: string | undefined,
): ThreadMessage[] | null {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  useEffect(() => {
    if (!threadId || !account) return;
    let stale = false;
    setMessages(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/mail/threads/${encodeURIComponent(threadId)}?account=${encodeURIComponent(account)}`,
        );
        const json = await res.json();
        if (!stale) setMessages(json.ok ? json.messages : []);
      } catch {
        if (!stale) setMessages([]);
      }
    })();
    return () => {
      stale = true;
    };
  }, [threadId, account]);
  return messages;
}

export function MailMessages({ messages }: { messages: ThreadMessage[] }) {
  return (
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
              {threadWhen(m.date)}
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
  );
}

// The briefs-page slide-over: thread + Reply in place.
export function MailThreadPanel({
  thread,
  onClose,
}: {
  thread: { threadId: string; account: string } | null;
  onClose: () => void;
}) {
  const messages = useMailThread(thread?.threadId, thread?.account);
  const [composeOpen, setComposeOpen] = useState(false);
  const [prefill, setPrefill] = useState<ComposePrefill | null>(null);

  function reply() {
    if (!thread || !messages?.length) return;
    const last = messages[messages.length - 1];
    const subject = messages[0]?.subject ?? "";
    setPrefill({
      to: extractEmailAddress(last.from) ?? "",
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      threadId: thread.threadId,
      account: thread.account,
    });
    setComposeOpen(true);
  }

  return (
    <>
      <SlideOver
        open={!!thread}
        onClose={onClose}
        label={messages?.[0]?.subject || "Mail"}
        accent="bg-lavender"
        footer={
          <button
            onClick={reply}
            disabled={!messages?.length}
            className="rounded-md border border-lavender/60 bg-lavender/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground transition enabled:hover:bg-lavender/20 disabled:opacity-40"
          >
            ↩ Reply
          </button>
        }
      >
        {messages === null ? (
          <p className="pulse-soft mt-8 text-center text-xs tracking-[0.3em] text-steel">
            SYNCING…
          </p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-steel">
            Couldn&apos;t load that thread.
          </p>
        ) : (
          <MailMessages messages={messages} />
        )}
      </SlideOver>
      <Compose
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        accounts={thread ? [thread.account] : []}
        prefill={prefill}
        onSent={() => {}}
      />
    </>
  );
}
