"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plate, usePlateEditor } from "platejs/react";
import type { Value } from "platejs";
import { EditorKit } from "@/components/editor/editor-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";
import type { StudioValue } from "../../../../convex/studioLib";

// The writing surface: Plate's full editor.
//
// DESIGN.md's "no component library for visual primitives" rule is
// DELIBERATELY relaxed here, and only here. Tarik asked for the real thing —
// lists, tables, links, media, a floating toolbar on selection, a slash menu,
// drag handles, DOCX export — and the honest version of that is Plate's own
// components rather than a hand-rolled imitation that is permanently one
// feature behind. The exception stops at this editor's frame; every other
// surface in Tarik OS is still hand-rolled Tailwind on the LCARS tokens.
//
// The AI menu is Plate's, on ⌘J, pointed at /api/ai/command — which was
// repointed from the Vercel AI Gateway to Claude on the key this project
// already has, so the editor writes in Zola's voice.
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
    plugins: EditorKit,
    // Cast at the boundary, deliberately. StudioValue is the STORAGE type and
    // its `children` is optional, because content arrives from a database and
    // from a model — studioLib has to survive a malformed node rather than
    // throw during a render. Plate's Value is the EDITOR type and is strict.
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
      <Plate editor={editor} onValueChange={onChange}>
        <EditorContainer variant="default" className="min-h-0 flex-1">
          <Editor key={documentId} variant="default" placeholder="Start writing…" />
        </EditorContainer>
      </Plate>
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
      {label || " "}
    </p>
  );
}
