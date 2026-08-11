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
 * Section headings a template supplies. Never a title.
 *
 * Found by using it: the brief template's first line with words in it is
 * "Summary", so every brief in the index was called Summary — five documents
 * that look identical in the one place they have to be told apart.
 */
const SECTION_HEADINGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

function textOf(node: StudioNode): string {
  const kids = Array.isArray(node.children) ? node.children : [];
  return kids
    .map((k) => (isText(k) ? k.text : textOf(k)))
    .join("")
    .trim();
}

/**
 * The document's title: what its author wrote, never what the template did.
 *
 * The first block with words in it wins, skipping the section headings a
 * template supplied — those are identical across every document of that type,
 * so using one names every brief "Summary".
 *
 * There is no special case for the h1. There was one, and the mutation sweep
 * showed it never changed an answer: the h1 leads every template, so it is
 * already the first non-section block this loop reaches. A branch that cannot
 * be observed is a branch to delete.
 */
export function deriveTitle(value: StudioValue): string {
  for (const block of Array.isArray(value) ? value : []) {
    if (!block || SECTION_HEADINGS.has(block.type ?? "")) continue;
    const text = textOf(block);
    if (text) return text.slice(0, TITLE_MAX);
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

// ----------------------------------------------------------- references

/**
 * What a Studio document can point at.
 *
 * References, not copies: a reference stores a type and the record's own id,
 * so a brief written in March still knows where it came from even after the
 * conversation behind it is gone.
 *
 * `canvas` is deliberately absent. Canvas does not exist yet — listing a type
 * nothing can resolve would put a dead option in the picker.
 */
export const REFERENCE_TYPES = [
  "brief",
  "conversation",
  "telos",
  "contact",
  "thought",
  "document",
  "url",
] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

/** One candidate from the source picker, whatever table it came from. */
export type SourceHit = {
  type: ReferenceType;
  sourceId: string;
  title: string;
  snippet: string;
  /** When the record was last touched. Breaks ties toward the newest. */
  at: number;
};

/** Comparable form: lowercase, punctuation gone, spacing collapsed. */
function comparable(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score one candidate. 0 means it does not belong in the picker at all.
 *
 * A title match beats a body match outright, because a long transcript that
 * says the word once would otherwise bury the brief actually called that.
 */
function scoreSource(hit: SourceHit, terms: string[]): number {
  const title = comparable(hit.title);
  const body = comparable(hit.snippet);

  // Every spoken word has to land somewhere, or "turnout brief" matches a
  // document called "Turnout" on one word out of two — the rule contact
  // search learned from real data.
  const haystack = `${title} ${body}`;
  if (!terms.every((t) => haystack.includes(t))) return 0;

  const joined = terms.join(" ");
  if (title === joined) return 100;
  if (terms.every((t) => title.includes(t))) return title.startsWith(joined) ? 70 : 60;
  return 20;
}

/**
 * The records worth offering for a query, best first.
 *
 * Non-matches are dropped rather than ranked low: a picker padded with weak
 * candidates is how the wrong record gets attached. Ties break on recency and
 * then on id, so the list cannot reorder under a stationary cursor between
 * keystrokes.
 */
export function rankSources(hits: SourceHit[], query: string): SourceHit[] {
  const terms = comparable(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  return hits
    .map((hit) => ({ hit, score: scoreSource(hit, terms) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, z) =>
        z.score - a.score ||
        z.hit.at - a.hit.at ||
        a.hit.sourceId.localeCompare(z.hit.sourceId),
    )
    .map((r) => r.hit);
}

/** How wide a chip may get before it breaks the line it sits in. */
const LABEL_MAX = 80;

/**
 * What a reference reads as on the page.
 *
 * Half the referenceable records have no title at all — a thought and a
 * transcript are just text — so an untitled one is named by its kind rather
 * than left blank in the middle of a sentence.
 */
export function sourceLabel(source: { type: string; title: string }): string {
  const title = (source.title ?? "").trim();
  if (!title) return `Untitled ${source.type}`;
  return title.length > LABEL_MAX ? `${title.slice(0, LABEL_MAX - 1)}…` : title;
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
