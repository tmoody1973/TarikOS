import { parseHTML } from "linkedom";

// Email HTML sanitizer (MOO-492). Server-side, before anything reaches the
// browser; the reading pane adds a sandboxed iframe on top. Philosophy:
// remove active content (scripts, handlers, embeds, forms), keep layout —
// real email depends on tables and inline styles.

const BLOCKED_SELECTOR = "script, iframe, object, embed, form, link, meta, base, applet";
const URL_ATTRS = ["href", "src", "action", "background"];
const NUL = String.fromCharCode(0);

function escapeText(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function sanitizeEmailHtml(raw: string): {
  html: string;
  fallback: boolean;
} {
  const clean = raw.replaceAll(NUL, "");
  try {
    const { document } = parseHTML(`<html><body>${clean}</body></html>`);
    for (const el of [...document.querySelectorAll(BLOCKED_SELECTOR)]) {
      el.remove();
    }
    for (const el of [...document.querySelectorAll("*")]) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          URL_ATTRS.includes(name) &&
          attr.value.trim().toLowerCase().startsWith("javascript:")
        ) {
          el.removeAttribute(attr.name);
        }
      }
    }
    return { html: document.body?.innerHTML ?? "", fallback: false };
  } catch {
    // Never ship raw markup on parser failure — escaped text beats nothing.
    return { html: `<pre>${escapeText(clean)}</pre>`, fallback: true };
  }
}
