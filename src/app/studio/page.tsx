"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DOC_TYPES, type DocType } from "../../../convex/studioLib";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { chicagoDateTime } from "@/lib/briefArchive";

// Studio index. The room where writing starts, so the primary action is
// starting something — the five type caps sit above the list, not behind a
// menu.
//
// Ochre, a new channel. Writing is not downstream of briefs or mail; it is the
// place they get made. The Channel Colour Rule says a new surface claims a hue,
// and lavender was already carrying three.

const TYPE_LABEL: Record<DocType, string> = {
  note: "NOTE",
  draft: "DRAFT",
  brief: "BRIEF",
  plan: "PLAN",
  decision: "DECISION",
};

/** What each type is for, in the words someone would use to choose one. */
const TYPE_BLURB: Record<DocType, string> = {
  note: "Catch a thought",
  draft: "Just write",
  brief: "Findings and a recommendation",
  plan: "Objective through risks",
  decision: "What was chosen, and why",
};

export default function StudioPage() {
  return (
    <>
      <Authenticated>
        <StudioInner />
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

function StudioInner() {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<DocType | "all">("all");
  const [creating, setCreating] = useState(false);

  const docs = useQuery(api.studio.list, { includeArchived: showArchived });
  const create = useMutation(api.studio.create);

  const shown = useMemo(
    () => (docs ?? []).filter((d) => filter === "all" || d.docType === filter),
    [docs, filter],
  );

  async function start(type: DocType) {
    if (creating) return;
    setCreating(true);
    try {
      const id = await create({ docType: type });
      router.push(`/studio/${id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-2 p-2">
      <Zone title="Studio" accent="bg-ochre">
        <p className="text-xs tracking-[0.2em] text-steel uppercase">Start something</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DOC_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => start(type)}
              disabled={creating}
              className="lcars-cap-left group flex min-w-40 flex-1 items-center gap-3 bg-ochre/80 px-4 py-2 text-left transition-opacity hover:bg-ochre disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
            >
              <span className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.15em] text-black">
                {TYPE_LABEL[type]}
              </span>
              <span className="text-[10px] leading-tight text-black/70">{TYPE_BLURB[type]}</span>
            </button>
          ))}
        </div>
      </Zone>

      <Zone title="Documents" accent="bg-ochre">
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip active={filter === "all"} onClick={() => setFilter("all")}>
            ALL
          </TypeChip>
          {DOC_TYPES.map((type) => (
            <TypeChip key={type} active={filter === type} onClick={() => setFilter(type)}>
              {TYPE_LABEL[type]}
            </TypeChip>
          ))}
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="ml-auto rounded-md border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>

        {docs === undefined ? (
          <p className="pulse-soft mt-4 text-xs tracking-[0.3em] text-steel">LOADING…</p>
        ) : shown.length === 0 ? (
          <ZoneEmpty>
            Nothing here yet. Pick a type above and start writing.
          </ZoneEmpty>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {shown.map((doc) => (
              <li key={doc._id}>
                <DocumentRow doc={doc} />
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </div>
  );
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none ${
        active
          ? "border-ochre bg-ochre/15 text-ochre"
          : "border-panel-edge text-steel hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function DocumentRow({
  doc,
}: {
  doc: {
    _id: Id<"studioDocs">;
    title: string;
    docType: DocType;
    excerpt: string;
    updatedAt: number;
    archivedAt?: number;
  };
}) {
  return (
    <Link
      href={`/studio/${doc._id}`}
      className="flex flex-col gap-1 rounded-md border border-panel-edge bg-black/20 px-3 py-2.5 transition-colors hover:border-ochre/60 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-foreground">
          {/* An untitled document still has to be findable in a list, so it is
              named by its type rather than left blank. */}
          {doc.title || `Untitled ${TYPE_LABEL[doc.docType].toLowerCase()}`}
        </span>
        <span className="text-[10px] uppercase tracking-[0.3em] text-ochre/70">
          {TYPE_LABEL[doc.docType]}
        </span>
        {doc.archivedAt ? (
          <span className="text-[10px] uppercase tracking-[0.3em] text-steel">ARCHIVED</span>
        ) : null}
        <span className="ml-auto text-[10px] tracking-[0.2em] text-steel">
          {chicagoDateTime(doc.updatedAt)}
        </span>
      </div>
      {doc.excerpt ? (
        <p className="line-clamp-2 text-xs text-steel">{doc.excerpt}</p>
      ) : null}
    </Link>
  );
}
