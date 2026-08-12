"use client";

import { useEffect, useState } from "react";
import { Authenticated, AuthLoading } from "convex/react";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { MailTabs } from "@/components/MailTabs";

// Zola's own inbox: zola@tarikos.app, on AgentMail.
//
// A tab under /mail rather than its own nav cap. isActiveRoute matches on
// startsWith, so MAIL stays lit here and the nav needed no change at all.
//
// What this shows and what she reads are deliberately different. The allowlist
// governs what reaches her reasoning automatically; it does not govern storage,
// and it does not govern what Tarik is allowed to see. So every message is
// here, and each row says which side of that line it sits on.
// docs/superpowers/specs/2026-08-12-zola-inbox-design.md

type Row = {
  id: string;
  from: string;
  subject: string;
  summary: string;
  timestamp: string;
  unread: boolean;
  listed: boolean;
  forwarded: boolean;
};

type Body = { from: string; subject: string; timestamp: string; text: string; forwarded: boolean };

function when(raw: string): string {
  const ms = Date.parse(raw);
  if (isNaN(ms)) return "";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ZolaMailPage() {
  return (
    <>
      <Authenticated>
        <ZolaMailInner />
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

function ZolaMailInner() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [body, setBody] = useState<Body | null>(null);

  useEffect(() => {
    fetch("/api/zola-mail")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error);
        setRows(j.messages);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't reach her inbox.");
        setRows([]);
      });
  }, []);

  // The body is not stored here — AgentMail holds it and it is fetched when he
  // actually opens something.
  useEffect(() => {
    if (!open?.id) return;
    setBody(null);
    let live = true;
    fetch(`/api/zola-mail?id=${encodeURIComponent(open.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (live && j.ok) setBody(j.message);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open?.id]);

  return (
    <div className="flex flex-1 gap-3">
      <div
        className={`w-full flex-col lg:flex lg:w-96 lg:shrink-0 ${open ? "hidden lg:flex" : "flex"}`}
      >
        <Zone title="Zola's mail" accent="bg-hopbush">
          <MailTabs />
          <p className="mb-3 text-xs text-steel">
            zola@tarikos.app — forward her anything. She reads senders on your
            list on her own; the rest wait here until you ask.
          </p>
          {error ? (
            <ZoneEmpty>{error}</ZoneEmpty>
          ) : rows === null ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : rows.length === 0 ? (
            <ZoneEmpty>Nothing has arrived yet.</ZoneEmpty>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto">
              {rows.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setOpen(m)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                      open?.id === m.id
                        ? "border-hopbush/60 bg-hopbush/10"
                        : "border-transparent hover:border-panel-edge hover:bg-black/30"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${m.unread ? "font-semibold text-foreground" : "text-foreground/75"}`}
                      >
                        {m.from}
                      </span>
                      <span className="shrink-0 text-[10px] tracking-wider text-steel">
                        {when(m.timestamp)}
                      </span>
                    </div>
                    <div className="truncate text-sm text-foreground/75">{m.subject}</div>
                    <div className="truncate text-xs text-steel">{m.summary}</div>
                    {/* Outside the truncating line on purpose: these two say
                        whether she read it on her own and whether Tarik sent
                        it, and a clipped label answers neither. */}
                    {m.forwarded || !m.listed ? (
                      <div className="mt-0.5 flex gap-2 text-[10px] uppercase tracking-wider">
                        {m.forwarded ? <span className="text-hopbush/70">forwarded</span> : null}
                        {!m.listed ? <span className="text-steel">not on your list</span> : null}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Zone>
      </div>

      <main className={`min-w-0 flex-1 flex-col lg:flex ${open ? "flex" : "hidden"}`}>
        <Zone title={open ? open.subject : "Reader"} accent="bg-hopbush">
          {!open ? (
            <ZoneEmpty>Select a message to read it here.</ZoneEmpty>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <button
                onClick={() => setOpen(null)}
                className="w-fit rounded-md border border-panel-edge px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-steel transition hover:border-hopbush/40 hover:text-foreground motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud lg:hidden"
              >
                ← Inbox
              </button>
              <p className="text-xs text-steel">
                {open.from} · {when(open.timestamp)}
                {open.forwarded ? " · forwarded" : ""}
              </p>
              {body === null ? (
                <ZoneEmpty>opening…</ZoneEmpty>
              ) : (
                // Plain text on purpose. Rendering a stranger's HTML inside the
                // dashboard is the one thing a public front door must not do.
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-sm text-foreground/85">
                  {body.text || "(no body)"}
                </pre>
              )}
            </div>
          )}
        </Zone>
      </main>
    </div>
  );
}
