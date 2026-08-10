"use client";

import { useEffect, useState } from "react";
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { checkShareAccess } from "../../../convex/documentsLib";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { chicagoDateTime } from "@/lib/briefArchive";

// Documents (MOO-586). Links get minted by voice, in a moment, possibly from
// a phone — this is the surface where every live one can be seen and killed.
// So share state is the content, not a footnote to a file list.
//
// Lavender: the same channel as BRIEFS and MAIL, because a document is what a
// brief becomes. It does not claim a new hue for a surface that is downstream
// of one that already has one.
export default function DocumentsPage() {
  return (
    <>
      <Authenticated>
        <DocumentsInner />
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

type ShareLink = {
  id: string;
  slug: string;
  expiresAt?: number;
  maxDownloads?: number;
  downloadCount: number;
  revoked: boolean;
  createdAt: number;
};

/**
 * One word for the state of a link, from the same rules `/f/[slug]` enforces.
 * A second opinion here would drift, and the page would show a link as live
 * that the route refuses — the worst possible disagreement on this surface.
 */
function linkState(link: ShareLink, now: number): {
  label: string;
  tone: string;
} {
  const verdict = checkShareAccess(link, now);
  if (verdict.allowed) return { label: "LIVE", tone: "text-cyan-hud" };
  const reason = verdict.reasons[0];
  if (reason === "revoked") return { label: "REVOKED", tone: "text-steel" };
  if (reason === "expired") return { label: "EXPIRED", tone: "text-steel" };
  return { label: "CAP REACHED", tone: "text-steel" };
}

function DocumentsInner() {
  const documents = useQuery(api.documents.list, {});
  const requestShare = useMutation(api.documents.requestShare);
  const createShareLink = useMutation(api.documents.createShareLink);
  const revokeShare = useMutation(api.documents.revokeShare);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Read once and ticked, rather than called during render. A clock frozen at
  // page load would keep showing LIVE after a link expired — on the one
  // surface whose job is to tell you whether a link is still working, that is
  // the exact wrong lie. A minute is finer than any expiry we set.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The same two-phase gate the voice path walks: ask, then spend the token.
  // The server refuses a link without one, so this is not the control — it is
  // the control being satisfied honestly, with the confirmation on screen
  // instead of spoken.
  async function share(documentId: string) {
    setBusy(documentId);
    try {
      const asked = await requestShare({
        documentId: documentId as Id<"documents">,
      });
      await createShareLink({
        documentId: documentId as Id<"documents">,
        confirmationToken: asked.confirmationToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Zone title="Documents" accent="bg-lavender">
        {documents === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : documents.length === 0 ? (
          <ZoneEmpty>
            Nothing saved yet. Ask Zola to save a brief, a research result, or
            this week&rsquo;s journal digest.
          </ZoneEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => {
              const live = doc.links.filter(
                (l) => checkShareAccess(l, now).allowed,
              );
              return (
                <li
                  key={doc.id}
                  className="rounded-md border border-panel-edge p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
                      {doc.sourceType.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] tracking-[0.2em] text-steel">
                      {chicagoDateTime(doc.createdAt)}
                    </span>
                    {live.length > 0 && (
                      <span className="rounded-full border border-cyan-hud px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
                        shared
                      </span>
                    )}
                  </div>

                  <h3 className="mt-1 font-[family-name:var(--font-mono-hud)] text-sm text-foreground/85 [overflow-wrap:anywhere]">
                    {doc.title}
                  </h3>
                  <p className="text-xs text-steel [overflow-wrap:anywhere]">
                    {doc.filename} · {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={`/api/documents/download?id=${doc.id}`}
                      className="rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-lavender hover:text-lavender focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                    >
                      download
                    </a>
                    {confirming === doc.id ? (
                      <>
                        <button
                          onClick={() => share(doc.id)}
                          disabled={busy === doc.id}
                          className="rounded-md border border-cyan-hud px-2.5 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-hud transition hover:bg-cyan-hud/10 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                        >
                          {busy === doc.id ? "sharing…" : "yes, share it"}
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirming(doc.id)}
                        className="rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-lavender hover:text-lavender focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                      >
                        create share link
                      </button>
                    )}
                  </div>

                  {confirming === doc.id && (
                    <p className="mt-2 text-xs text-foreground/85 [overflow-wrap:anywhere]">
                      A link works for anyone who has it, with no sign-in. It
                      expires in seven days unless you revoke it first.
                    </p>
                  )}

                  {doc.links.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2 border-t border-panel-edge pt-2">
                      {doc.links.map((link) => {
                        const state = linkState(link, now);
                        return (
                          <li
                            key={link.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1"
                          >
                            <span
                              className={`text-[10px] uppercase tracking-[0.3em] ${state.tone}`}
                            >
                              {state.label}
                            </span>
                            <span className="text-xs text-steel [overflow-wrap:anywhere]">
                              /f/{link.slug}
                            </span>
                            <span className="text-[10px] tracking-[0.2em] text-steel">
                              {link.downloadCount} download
                              {link.downloadCount === 1 ? "" : "s"}
                            </span>
                            <span className="text-[10px] tracking-[0.2em] text-steel">
                              {link.expiresAt
                                ? `expires ${chicagoDateTime(link.expiresAt)}`
                                : "no expiry"}
                            </span>
                            {!link.revoked && (
                              <button
                                onClick={async () => {
                                  setBusy(link.id);
                                  try {
                                    await revokeShare({ slug: link.slug });
                                  } finally {
                                    setBusy(null);
                                  }
                                }}
                                disabled={busy === link.id}
                                className="ml-auto rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                              >
                                {busy === link.id ? "revoking…" : "revoke"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Zone>
    </div>
  );
}
