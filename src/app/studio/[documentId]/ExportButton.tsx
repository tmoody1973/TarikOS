"use client";

import { useState } from "react";
import { exportToDocx } from "@platejs/docx-io";
import type { SlatePlugin } from "platejs";
import { useEditorRef } from "platejs/react";
import { BaseEditorKit } from "@/components/editor/editor-base-kit";
import { DocxExportKit } from "@/components/editor/plugins/docx-export-kit";

// Export this document to Word, into the store that already knows how to
// share things.
//
// Plate's own export button downloads the file and forgets it. This one puts
// the bytes in `documents` instead, which already does presigned links,
// expiry, download caps and revocation — so an export becomes something Tarik
// can SEND, not just something in his downloads folder. The same reasoning
// that made Studio link to briefs rather than own them: one store for
// "an artifact I can hand to someone".
//
// The .docx is built in the browser because that is where Plate's exporter
// runs; the route only receives the bytes.

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; filename: string }
  | { kind: "error"; message: string };

export function ExportButton({
  documentId,
  title,
  revision,
}: {
  documentId: string;
  title: string;
  revision: number;
}) {
  const editor = useEditorRef();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      const blob = await exportToDocx(editor.children, {
        editorPlugins: [...BaseEditorKit, ...DocxExportKit] as SlatePlugin[],
      });

      const form = new FormData();
      form.set("file", blob);
      form.set("title", title);
      form.set("sourceId", documentId);
      form.set("revision", String(revision));

      const res = await fetch("/api/studio/export", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; filename?: string; error?: string }
        | null;

      if (!res.ok || !body?.ok) {
        setState({ kind: "error", message: body?.error ?? "The export didn't save." });
        return;
      }
      setState({ kind: "done", filename: body.filename ?? "document.docx" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "The export failed.",
      });
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={() => void run()}
        disabled={state.kind === "working"}
        title="Export to Word and save it to Documents"
        className="rounded-md border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
      >
        {state.kind === "working" ? "Exporting…" : "Export .docx"}
      </button>
      {state.kind === "done" ? (
        // Says where it went, because an export that vanishes silently reads
        // as one that failed.
        <a
          href="/documents"
          className="hud-glow text-[10px] uppercase tracking-[0.3em] text-cyan-hud underline"
        >
          Saved to Documents
        </a>
      ) : null}
      {state.kind === "error" ? (
        <span role="alert" className="text-[10px] text-salmon">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
