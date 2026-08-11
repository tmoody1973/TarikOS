// Studio's pure document logic.
//
// Lives in convex/ for the same reason contactsLib and documentsLib do — Convex
// functions cannot import from src/, and both the /studio pages and the Convex
// queries need to read a document's text. Pure and dependency-free, so the
// tree-walking rules can be tested without an editor or a database.
//
// Plate stores a Slate value: an ARRAY of block nodes, each carrying a
// `children` array of either text nodes or further blocks. A list's text is two
// levels down, so anything that reads a document has to recurse — reading only
// the top level silently drops every bullet, which is the kind of bug that
// shows up as "search can't find it" months later.

/** A text node: the string plus whatever marks are set on it. */
export type StudioText = { text: string; [mark: string]: unknown };

/** A block node. `children` holds text nodes or nested blocks. */
export type StudioNode = {
  type?: string;
  children?: (StudioText | StudioNode)[];
  [prop: string]: unknown;
};

/** A whole document, as Plate hands it over and as it is stored. */
export type StudioValue = StudioNode[];

/**
 * The five document types.
 *
 * Exported as a list rather than only a union so tests can walk every one —
 * a union alone lets a new type ship with no template and no test noticing.
 */
export const DOC_TYPES = ["note", "draft", "brief", "plan", "decision"] as const;

export type DocType = (typeof DOC_TYPES)[number];

/** A title long enough to be useful, short enough for a breadcrumb and a row. */
const TITLE_MAX = 120;

function isText(node: StudioText | StudioNode): node is StudioText {
  return typeof (node as StudioText).text === "string";
}

/**
 * Every block's text, one block per line.
 *
 * One line per block because the alternative glues a heading onto the sentence
 * after it, and every excerpt then opens with two ideas run together.
 *
 * Tolerant of malformed nodes on purpose: this runs over content that came back
 * from a database and, in Phase 3, from a model. A node missing `children` must
 * not throw during a page render.
 */
export function plainText(value: StudioValue): string {
  const lines: string[] = [];

  const walk = (node: StudioText | StudioNode): string => {
    if (isText(node)) return node.text;
    const kids = Array.isArray(node.children) ? node.children : [];
    return kids.map(walk).join("");
  };

  for (const node of Array.isArray(value) ? value : []) {
    if (!node) continue;
    // A list is a block of blocks: its items each deserve their own line,
    // rather than arriving as one run-on string.
    const kids = Array.isArray(node.children) ? node.children : [];
    const nestedBlocks = kids.filter((k) => !isText(k)) as StudioNode[];
    if (nestedBlocks.length > 0 && nestedBlocks.length === kids.length) {
      for (const block of nestedBlocks) lines.push(walk(block));
    } else {
      lines.push(walk(node));
    }
  }

  return lines.join("\n");
}

/**
 * The document's title, taken from its first line with words in it.
 *
 * Skips leading blanks rather than stopping at them: every template opens with
 * an empty heading, so the first block is blank exactly when someone started
 * typing in the body instead — which is the case where a derived title matters
 * most.
 */
export function deriveTitle(value: StudioValue): string {
  for (const line of plainText(value).split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, TITLE_MAX);
  }
  return "";
}

/**
 * A preview for the document index, cut at a word boundary.
 *
 * Cutting at exactly `max` lands mid-word most of the time, and a wall of rows
 * ending in "numb…" reads as broken rather than truncated.
 */
export function excerpt(value: StudioValue, max: number): string {
  const text = plainText(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour the space if it leaves most of the budget intact; a single very
  // long word would otherwise collapse the excerpt to nothing.
  return `${lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut}…`;
}

function heading(text: string): StudioNode {
  return { type: "h2", children: [{ text }] };
}

function paragraph(text = ""): StudioNode {
  return { type: "p", children: [{ text }] };
}

/** A titled document with a section per heading. */
function sectioned(headings: string[]): StudioValue {
  return [
    { type: "h1", children: [{ text: "" }] },
    ...headings.flatMap((h) => [heading(h), paragraph()]),
  ];
}

/**
 * The starting content for a new document.
 *
 * Templates are starter content, not a schema — the structure can be torn up
 * immediately. Built fresh on every call rather than returned from a module
 * constant: a shared value would let the first document's first edit mutate the
 * template every later document is created from.
 */
export function templateFor(type: DocType): StudioValue {
  switch (type) {
    // A note imposes no shape. That is the whole point of a note.
    case "note":
      return [paragraph()];
    case "draft":
      return [{ type: "h1", children: [{ text: "" }] }, paragraph()];
    case "brief":
      return sectioned(["Summary", "Context", "Findings", "Recommendation", "Next steps"]);
    case "plan":
      return sectioned(["Objective", "Outcomes", "Milestones", "Actions", "Risks"]);
    case "decision":
      return sectioned(["Context", "Options", "Decision", "Rationale", "Consequences"]);
  }
}
