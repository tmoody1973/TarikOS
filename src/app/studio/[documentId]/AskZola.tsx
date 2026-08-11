"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Ask Zola to change something, then decide whether she was right.
//
// The rule from the PRD, and the reason this panel exists at all: SHE
// PROPOSES, YOU DECIDE. Nothing she writes touches the document until Accept
// is pressed. The old text stays on screen beside the new one the whole time,
// because the moment before you accept is the last moment it exists.
//
// Hand-rolled rather than Plate's AI menu: that menu is shadcn, and DESIGN.md
// forbids a component library for visual primitives. The editor API gives the
// two things actually needed — read the selection, replace the selection.

/** The quick actions worth a keystroke. Anything else is typed. */
const QUICK: { label: string; instruction: string }[] = [
  { label: "TIGHTEN", instruction: "Make this shorter and clearer without losing anything it says." },
  { label: "EXPAND", instruction: "Add the useful detail this is missing. Do not pad it." },
  { label: "PLAIN", instruction: "Rewrite this in plain language. No jargon, no corporate register." },
  { label: "ASSUMPTIONS", instruction: "List the assumptions this text is making, as short bullet points." },
  { label: "ACTIONS", instruction: "Extract the action items from this, as short bullet points." },
];

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "proposed"; text: string }
  | { kind: "error"; message: string };

export function AskZola({
  open,
  onClose,
  selectedText,
  docType,
  references,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  selectedText: string;
  docType: string;
  references: { sourceType: string; label: string }[];
  onAccept: (text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Aborted when the panel closes, so a request nobody is waiting for stops
  // costing tokens the moment it stops being wanted.
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setPhase({ kind: "idle" });
      setInstruction("");
      inputRef.current?.focus();
    } else {
      abort.current?.abort();
    }
  }, [open]);

  const ask = useCallback(
    async (what: string) => {
      if (!what.trim() || !selectedText.trim()) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setPhase({ kind: "asking" });

      try {
        const res = await fetch("/api/studio/ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instruction: what,
            text: selectedText,
            docType,
            references,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setPhase({
            kind: "error",
            message: (await res.text()) || "Zola couldn't answer that one.",
          });
          return;
        }

        // Streamed, so the words appear as she writes them rather than after a
        // silence long enough to look broken.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let out = "";
        setPhase({ kind: "proposed", text: "" });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out += decoder.decode(value, { stream: true });
          setPhase({ kind: "proposed", text: out });
        }
        setPhase({ kind: "proposed", text: out.trim() });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    },
    [selectedText, docType, references],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Ask Zola"
      className="border-t border-panel-edge bg-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="lcars-cap-left h-3 w-6 bg-ochre" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-steel">Ask Zola</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-md border border-panel-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
        >
          Close
        </button>
      </div>

      {!selectedText.trim() ? (
        <p className="px-3 py-3 text-xs italic text-steel">
          Select the words you want changed first — she only works on what you point at.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {QUICK.map((q) => (
              <button
                key={q.label}
                onClick={() => void ask(q.instruction)}
                disabled={phase.kind === "asking"}
                className="rounded-full border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
              >
                {q.label}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(instruction);
            }}
          >
            <input
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Or say what you want changed…"
              aria-label="What should Zola change?"
              className="flex-1 rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-ochre/60"
            />
            <button
              type="submit"
              disabled={phase.kind === "asking" || !instruction.trim()}
              className="rounded-md border border-panel-edge px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-ochre hover:text-ochre disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
            >
              Ask
            </button>
          </form>

          {phase.kind === "asking" ? (
            <p className="pulse-soft px-3 pb-3 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
              Zola is thinking…
            </p>
          ) : null}

          {phase.kind === "error" ? (
            <p role="alert" className="px-3 pb-3 text-xs text-salmon">
              {phase.message}
            </p>
          ) : null}

          {phase.kind === "proposed" ? (
            <div className="px-3 pb-3">
              {/* Both versions, side by side. The old text is the thing about to
                  disappear, so it does not get hidden behind a toggle. */}
              <div className="grid gap-2 md:grid-cols-2">
                <Pane label="Now" tone="text-steel" body={selectedText} />
                <Pane label="Zola's version" tone="text-ochre" body={phase.text} />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    onAccept(phase.text);
                    onClose();
                  }}
                  disabled={!phase.text.trim()}
                  className="rounded-md border border-ochre px-3 py-0.5 text-[10px] uppercase tracking-[0.3em] text-ochre transition-colors hover:bg-ochre/15 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                >
                  Use this
                </button>
                <button
                  onClick={() => setPhase({ kind: "idle" })}
                  className="rounded-md border border-panel-edge px-3 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Pane({ label, tone, body }: { label: string; tone: string; body: string }) {
  return (
    <div className="rounded-md border border-panel-edge bg-black/20 p-2.5">
      <p className={`mb-1 text-[10px] uppercase tracking-[0.3em] ${tone}`}>{label}</p>
      <p className="whitespace-pre-wrap text-sm leading-[1.6] text-foreground/85">
        {body || "…"}
      </p>
    </div>
  );
}
