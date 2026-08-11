"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plate, PlateContent, usePlateEditor, type PlateElementProps } from "platejs/react";
import type { Value } from "platejs";
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
} from "@platejs/basic-nodes/react";
import type { StudioValue } from "../../../../convex/studioLib";

// The writing surface.
//
// Elements are hand-rolled rather than pulled from Plate's shadcn registry:
// DESIGN.md forbids a component library for visual primitives, and a document
// on this system reads in Geist Mono on space-black like everything else.
//
// The save story is the reason this file is careful. Plate fires on every
// keystroke; we debounce, and every save carries the revision it was written
// from. A save the server refuses as stale STOPS the loop and says so, because
// a silent retry would keep overwriting with the same old text.

export type SaveOutcome =
  | { ok: true; revision: number }
  | { ok: false; reason: "stale" | "missing" | "too_large"; revision?: number };

/** How long after the last keystroke a save goes out. */
const AUTOSAVE_MS = 900;

type Status =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "blocked"; message: string };

function Block({ children, attributes, className }: PlateElementProps & { className: string }) {
  return (
    <div {...attributes} className={className}>
      {children}
    </div>
  );
}

const H1 = (props: PlateElementProps) => (
  <Block
    {...props}
    className="mt-6 mb-2 font-[family-name:var(--font-display)] text-2xl uppercase tracking-[0.05em] text-foreground first:mt-0"
  />
);

const H2 = (props: PlateElementProps) => (
  <Block
    {...props}
    className="mt-5 mb-1 font-[family-name:var(--font-display)] text-lg uppercase tracking-[0.05em] text-ochre"
  />
);

const H3 = (props: PlateElementProps) => (
  <Block
    {...props}
    className="mt-4 mb-1 text-xs uppercase tracking-[0.3em] text-steel"
  />
);

// min-h-6 so an EMPTY paragraph is still a target. Found by using it: the
// blank paragraphs a template puts between its headings collapse to zero
// height, so a click aimed at one lands on the nearest heading instead and the
// sentence gets typed into "Context".
const Paragraph = (props: PlateElementProps) => (
  <Block {...props} className="my-2 min-h-6 text-sm leading-[1.7] text-foreground/85" />
);

const Blockquote = (props: PlateElementProps) => (
  <Block
    {...props}
    className="my-3 border-l-2 border-ochre/50 pl-3 text-sm italic text-steel"
  />
);

export function StudioEditor({
  documentId,
  initialContent,
  initialRevision,
  save,
}: {
  documentId: string;
  initialContent: StudioValue;
  initialRevision: number;
  save: (content: string, revision: number) => Promise<SaveOutcome>;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // The revision lives in a ref, not in state: the autosave timer closes over
  // it, and a stale closure here is the exact bug the counter exists to catch.
  const revision = useRef(initialRevision);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);

  const editor = usePlateEditor({
    plugins: [
      BasicBlocksPlugin,
      BasicMarksPlugin,
      // ponytail: five node types is what the templates use. Lists, tables and
      // the reference node land in Phase 2 with the source picker they need.
    ],
    components: {
      h1: H1,
      h2: H2,
      h3: H3,
      p: Paragraph,
      blockquote: Blockquote,
    },
    // Cast at the boundary, deliberately. StudioValue is the STORAGE type and
    // its `children` is optional, because content arrives from a database and,
    // in Phase 3, from a model — studioLib has to survive a malformed node
    // rather than throw during a render. Plate's Value is the EDITOR type and
    // is strict. The tolerance belongs on the reading side; this is the one
    // place the two meet.
    value: (initialContent.length > 0
      ? initialContent
      : [{ type: "p", children: [{ text: "" }] }]) as unknown as Value,
  });

  const flush = useCallback(async () => {
    const content = pending.current;
    if (content === null || blocked.current) return;
    pending.current = null;
    setStatus({ kind: "saving" });

    const result = await save(content, revision.current);
    if (result.ok) {
      revision.current = result.revision;
      setStatus({ kind: "saved", at: Date.now() });
      return;
    }

    // Refused. Stop writing rather than retrying — every retry would carry the
    // same outdated document and, if it ever won, delete whatever replaced it.
    blocked.current = true;
    setStatus({
      kind: "blocked",
      message:
        result.reason === "stale"
          ? "This document changed somewhere else. Reload to pick up the newer version — your text here is still on screen, so copy anything you need first."
          : result.reason === "too_large"
            ? "This document is too large to save. Split it before writing more."
            : "This document no longer exists.",
    });
  }, [save]);

  const onChange = useCallback(
    ({ value }: { value: unknown }) => {
      if (blocked.current) return;
      pending.current = JSON.stringify(value);
      setStatus({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  // A pending edit must not die with the page. Without this, typing and
  // closing the tab inside the debounce window loses the last thing written —
  // the failure this whole file is built to prevent, arriving by another door.
  useEffect(() => {
    const onHide = () => {
      if (pending.current !== null) void flush();
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SaveState status={status} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Plate editor={editor} onValueChange={onChange}>
          <PlateContent
            key={documentId}
            placeholder="Start writing…"
            spellCheck
            className="mx-auto max-w-3xl px-4 py-6 outline-none [&_strong]:font-bold [&_strong]:text-foreground [&_em]:italic [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_code]:text-ochre"
          />
        </Plate>
      </div>
    </div>
  );
}

/**
 * The save indicator.
 *
 * "Saved" glows because it is a live reading — Glow Means Live. A blocked save
 * takes salmon and the full width, because it is the one state where carrying
 * on typing costs something.
 */
function SaveState({ status }: { status: Status }) {
  if (status.kind === "blocked") {
    return (
      <p
        role="alert"
        className="border-b border-salmon/40 bg-salmon/10 px-4 py-2 text-xs leading-relaxed text-salmon"
      >
        {status.message}
      </p>
    );
  }

  const label =
    status.kind === "saving"
      ? "SAVING…"
      : status.kind === "saved"
        ? "SAVED"
        : status.kind === "dirty"
          ? "UNSAVED"
          : "";

  return (
    <p
      className={`px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] ${
        status.kind === "saved" ? "hud-glow text-cyan-hud" : "text-steel"
      }`}
      aria-live="polite"
    >
      {label || " "}
    </p>
  );
}
