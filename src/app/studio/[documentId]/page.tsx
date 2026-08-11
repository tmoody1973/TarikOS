"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { StudioValue } from "../../../../convex/studioLib";
import { chicagoDateTime } from "@/lib/briefArchive";
import { StudioEditor, type SaveOutcome } from "./StudioEditor";

// One document. Editor in the middle, its history behind a toggle.
//
// Desktop-first by design: this is the one surface in Tarik OS that is about
// sustained writing rather than a reading at a glance. Below lg the history
// panel yields entirely to the document instead of reflowing beside it, the
// same rule /mail and /contacts follow — a split at 375px leaves both halves
// unusable.

export default function StudioDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = use(params);
  return (
    <>
      <Authenticated>
        <DocumentInner id={documentId as Id<"studioDocs">} />
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

function DocumentInner({ id }: { id: Id<"studioDocs"> }) {
  const router = useRouter();
  const doc = useQuery(api.studio.get, { id });
  const [showHistory, setShowHistory] = useState(false);

  const saveDoc = useMutation(api.studio.save);
  const rename = useMutation(api.studio.rename);
  const snapshot = useMutation(api.studio.snapshot);
  const setArchived = useMutation(api.studio.setArchived);

  const save = useCallback(
    (content: string, revision: number): Promise<SaveOutcome> =>
      saveDoc({ id, content, revision }) as Promise<SaveOutcome>,
    [saveDoc, id],
  );

  if (doc === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="pulse-soft text-xs tracking-[0.3em] text-steel">LOADING…</p>
      </div>
    );
  }

  if (doc === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-steel">That document is gone.</p>
        <Link
          href="/studio"
          className="rounded-md border border-panel-edge px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre motion-reduce:transition-none"
        >
          Back to Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <header className="flex flex-wrap items-center gap-2 rounded-lg border border-panel-edge bg-panel px-3 py-2">
        <Link
          href="/studio"
          className="lcars-cap-left h-4 w-8 shrink-0 bg-ochre focus-visible:outline-2 focus-visible:outline-cyan-hud"
          aria-label="Back to Studio"
        />
        <input
          value={doc.title}
          onChange={(e) => void rename({ id, title: e.target.value })}
          placeholder={`Untitled ${doc.docType}`}
          aria-label="Document title"
          className="min-w-40 flex-1 bg-transparent font-[family-name:var(--font-display)] text-lg uppercase tracking-[0.05em] text-foreground outline-none placeholder:text-steel/60 focus:text-ochre"
        />
        <span className="text-[10px] uppercase tracking-[0.3em] text-ochre/70">{doc.docType}</span>
        <button
          onClick={() => void snapshot({ id })}
          className="rounded-md border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
        >
          Keep version
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          className="rounded-md border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
        >
          History
        </button>
        <button
          onClick={async () => {
            await setArchived({ id, archived: !doc.archivedAt });
            if (!doc.archivedAt) router.push("/studio");
          }}
          className="rounded-md border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
        >
          {doc.archivedAt ? "Unarchive" : "Archive"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-panel-edge bg-panel">
          <StudioEditor
            documentId={id}
            initialContent={parseContent(doc.content)}
            initialRevision={doc.revision}
            save={save}
          />
        </section>
        {showHistory ? <HistoryPanel id={id} /> : null}
      </div>
    </div>
  );
}

/** Stored content, or an empty document if it cannot be read. */
function parseContent(content: string): StudioValue {
  try {
    const value = JSON.parse(content);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function HistoryPanel({ id }: { id: Id<"studioDocs"> }) {
  const versions = useQuery(api.studio.versions, { id });
  const restore = useMutation(api.studio.restoreVersion);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <aside className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-panel-edge bg-panel lg:w-80">
      <h2 className="border-b border-panel-edge px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-steel">
        History
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {versions === undefined ? (
          <p className="pulse-soft text-xs tracking-[0.3em] text-steel">LOADING…</p>
        ) : versions.length === 0 ? (
          <p className="text-xs italic text-steel">
            No versions kept yet. Keep version saves this moment so you can come back to it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((v) => (
              <li
                key={v._id}
                className="rounded-md border border-panel-edge bg-black/20 px-2.5 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] tracking-[0.2em] text-steel">
                    {chicagoDateTime(v.createdAt)}
                  </span>
                  {v.label ? (
                    <span className="text-[10px] uppercase tracking-[0.3em] text-ochre/70">
                      {v.label}
                    </span>
                  ) : null}
                </div>
                {v.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-xs text-steel">{v.excerpt}</p>
                ) : null}
                {/* Restore replaces what is on screen, so it asks first. The
                    current text is snapshotted either way, but a confirm is
                    cheaper than explaining that afterwards. */}
                {confirming === v._id ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={async () => {
                        await restore({ id, versionId: v._id });
                        setConfirming(null);
                        // The editor holds the old text in memory; a reload is
                        // the honest way to show what the document now is.
                        window.location.reload();
                      }}
                      className="rounded-md border border-salmon px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-md border border-panel-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel focus-visible:outline-2 focus-visible:outline-cyan-hud"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(v._id)}
                    className="mt-1.5 rounded-md border border-panel-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre motion-reduce:transition-none"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
