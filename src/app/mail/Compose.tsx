"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { SlideOver } from "@/components/SlideOver";

// Compose SlideOver (MOO-493): TipTap → HTML, draft-first save to Gmail,
// send only on the explicit SEND click. Draft edits replace (delete+create
// server-side); the editor keeps content, so a failed replace loses nothing.

export type ComposePrefill = {
  to?: string;
  subject?: string;
  threadId?: string;
};

type Status =
  | { kind: "idle" | "saving" | "sending" | "saved" | "sent" }
  | { kind: "error"; message: string };

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`rounded border px-2 py-0.5 text-xs transition ${
        active
          ? "border-lavender/70 bg-lavender/20 text-foreground"
          : "border-panel-edge text-steel hover:border-lavender/40"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  function applyLink() {
    const url = linkUrl.trim();
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkOpen(false);
    setLinkUrl("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-panel-edge pb-2">
      <ToolbarButton active={state.bold} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton active={state.italic} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton active={state.bullet} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        • List
      </ToolbarButton>
      <ToolbarButton active={state.ordered} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. List
      </ToolbarButton>
      <ToolbarButton
        active={state.link}
        label="Link"
        onClick={() => {
          setLinkUrl(editor.getAttributes("link").href ?? "");
          setLinkOpen((v) => !v);
        }}
      >
        Link
      </ToolbarButton>
      {linkOpen && (
        <span className="flex items-center gap-1">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
            placeholder="https://…"
            className="w-48 rounded border border-panel-edge bg-black/30 px-2 py-0.5 text-xs text-foreground outline-none focus:border-lavender/60"
          />
          <ToolbarButton label="Apply link" onClick={applyLink}>
            ✓
          </ToolbarButton>
        </span>
      )}
    </div>
  );
}

export function Compose({
  open,
  onClose,
  accounts,
  prefill,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  accounts: string[];
  prefill: ComposePrefill | null;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [account, setAccount] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[40vh] rounded-md border border-panel-edge bg-black/20 px-3 py-2 text-sm text-foreground outline-none focus:border-lavender/50 [&_a]:text-lavender [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:pl-5",
      },
    },
  });

  // Reset per open: new compose starts clean, reply starts prefilled.
  useEffect(() => {
    if (!open) return;
    setTo(prefill?.to ?? "");
    setSubject(prefill?.subject ?? "");
    setAccount(accounts.find((a) => a.toLowerCase().includes("work")) ?? accounts[0] ?? "");
    setDraftId(null);
    setStatus({ kind: "idle" });
    editor?.commands.setContent("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  async function saveDraft(): Promise<string | null> {
    if (!editor) return null;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/mail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          bodyHtml: editor.getHTML(),
          account,
          threadId: prefill?.threadId,
          replaceDraftId: draftId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setDraftId(json.draftId);
      setStatus({ kind: "saved" });
      return json.draftId as string;
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Draft save failed — content is still here, try again.",
      });
      return null;
    }
  }

  async function send() {
    // Draft-first always: save (create or replace), then send that draft.
    const id = await saveDraft();
    if (!id) return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`/api/mail/drafts/${encodeURIComponent(id)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setStatus({ kind: "sent" });
      onSent();
      setTimeout(onClose, 900);
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Send failed — the draft is still in Gmail.",
      });
    }
  }

  const busy = status.kind === "saving" || status.kind === "sending";
  const canAct = to.trim().length > 0 && !busy;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label={prefill?.threadId ? "Reply" : "Compose"}
      accent="bg-lavender"
      footer={
        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={!canAct}
            className="rounded-md border border-lavender/70 bg-lavender/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground transition enabled:hover:bg-lavender/25 disabled:opacity-40"
          >
            {status.kind === "sending" ? "Sending…" : "Send"}
          </button>
          <button
            onClick={saveDraft}
            disabled={!canAct}
            className="rounded-md border border-panel-edge px-3 py-1.5 text-xs uppercase tracking-wider text-steel transition enabled:hover:border-lavender/40 disabled:opacity-40"
          >
            {status.kind === "saving" ? "Saving…" : "Save draft"}
          </button>
          <span
            role="status"
            className={`text-xs ${status.kind === "error" ? "text-salmon" : "text-steel"}`}
          >
            {status.kind === "saved" && "Draft saved to Gmail."}
            {status.kind === "sent" && "Sent."}
            {status.kind === "error" && status.message}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {accounts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <button
                key={a}
                onClick={() => setAccount(a)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                  account === a
                    ? "border-lavender/70 bg-lavender/15 text-foreground"
                    : "border-panel-edge text-steel hover:border-lavender/40"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-steel">
          <span className="w-14 uppercase tracking-wider">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="someone@example.com"
            className="flex-1 rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-lavender/50"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-steel">
          <span className="w-14 uppercase tracking-wider">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-lavender/50"
          />
        </label>
        {editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </SlideOver>
  );
}
