import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";
import { shouldEscalate, MIN_ARTICLE_CHARS } from "./readerEscalation.ts";
import { cleanTitle, cleanByline } from "./readerTitle.ts";

// Server-side article extraction for the reader pane: fetch a source URL,
// run Firefox's Readability parser (on linkedom — jsdom can't load in the
// Vercel runtime, its deps require() ESM-only modules), sanitize the result
// down to a tight tag allowlist so it's safe for dangerouslySetInnerHTML.

export type ReaderArticle = {
  title: string;
  byline: string | null;
  siteName: string | null;
  html: string;
  excerpt: string | null;
};

export class ReaderError extends Error {}

// ponytail: hostname-string check only; DNS-rebinding is out of scope for a
// single-user, auth-gated personal app.
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ReaderError("Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReaderError("Only http(s) URLs can be read.");
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (isPrivate) {
    throw new ReaderError("That address isn't readable.");
  }
  return url;
}

function absolutize(ref: string | undefined, base: URL): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref, base).href;
  } catch {
    return undefined;
  }
}

type ParsedArticle = ReturnType<Readability["parse"]>;

function parseArticle(html: string): ParsedArticle {
  const { document } = parseHTML(html);
  return new Readability(document as unknown as Document).parse();
}

function articleChars(article: ParsedArticle): number {
  return (article?.textContent ?? "").trim().length;
}

function looksLikeDocument(html: string): boolean {
  return /<(!doctype|html|body|article|div)[\s>]/i.test(html.slice(0, 2000));
}

// Direct fetch. Returns the status alongside the body so the caller can decide
// whether a failure is worth escalating, instead of throwing on the spot.
async function fetchDirect(
  url: URL,
): Promise<{ status: number | null; html: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some publishers serve bots an empty shell; present as a browser.
        // Note this does NOT defeat Cloudflare — it fingerprints the IP, which
        // is why the Firecrawl tier below exists.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: res.status, html: "" };
    return { status: res.status, html: (await res.text()).slice(0, 3_000_000) };
  } catch {
    // Reset/timeout: no status to reason about, and often blocking in disguise.
    return { status: null, html: "" };
  }
}

// Second tier: a real browser on a real IP, via Firecrawl. Asks for HTML
// rather than markdown on purpose — the same Readability pass then strips the
// cookie banners and nav that onlyMainContent leaves behind, and the output
// goes through the identical sanitizer, so this adds no new HTML surface.
type Escalated = { html: string; title?: string; description?: string };

async function fetchViaFirecrawl(url: URL): Promise<Escalated> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { html: "" };
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: url.href, formats: ["html"] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { html: "" };
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        html?: string;
        metadata?: Record<string, string | undefined>;
      };
    };
    if (!json.success) return { html: "" };
    const meta = json.data?.metadata ?? {};
    return {
      html: (json.data?.html ?? "").slice(0, 3_000_000),
      // Firecrawl's HTML drops the head, so Readability has no <title> to read
      // and falls back to the hostname. Its metadata carries the real one.
      title: meta.title || meta.ogTitle || meta["og:title"],
      description: meta.description || meta["og:description"],
    };
  } catch {
    return { html: "" };
  }
}

export async function extractArticle(rawUrl: string): Promise<ReaderArticle> {
  const url = assertSafeUrl(rawUrl);

  const direct = await fetchDirect(url);
  let rawHtml = direct.html;
  let article = rawHtml && looksLikeDocument(rawHtml) ? parseArticle(rawHtml) : null;

  let escalatedMeta: Escalated | null = null;
  if (
    shouldEscalate({
      status: direct.status,
      extractedChars: articleChars(article),
    })
  ) {
    const viaBrowser = await fetchViaFirecrawl(url);
    if (viaBrowser.html && looksLikeDocument(viaBrowser.html)) {
      const escalated = parseArticle(viaBrowser.html);
      if (articleChars(escalated) >= MIN_ARTICLE_CHARS) {
        rawHtml = viaBrowser.html;
        article = escalated;
        escalatedMeta = viaBrowser;
      }
    }
  }

  if (!rawHtml) {
    throw new ReaderError(
      direct.status === null
        ? "Couldn't reach that page."
        : `The site answered ${direct.status}.`,
    );
  }
  if (!looksLikeDocument(rawHtml)) {
    throw new ReaderError("That link isn't an article page.");
  }
  if (!article?.content || articleChars(article) < MIN_ARTICLE_CHARS) {
    throw new ReaderError("Couldn't extract readable text from that page.");
  }

  const html = sanitizeHtml(article.content, {
    allowedTags: [
      "p", "h1", "h2", "h3", "h4", "a", "ul", "ol", "li", "blockquote",
      "em", "strong", "b", "i", "code", "pre", "figure", "figcaption",
      "img", "br", "hr", "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["https", "http"],
    transformTags: {
      // Resolve relative URLs here (deterministic regardless of DOM lib).
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          href: absolutize(attribs.href, url) ?? "",
          target: "_blank",
          rel: "noreferrer",
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, src: absolutize(attribs.src, url) ?? "" },
      }),
    },
  });

  // Readability's own values win; the escalation's metadata fills the gaps it
  // leaves (its HTML has no <head>), and the hostname is the last resort.
  const rawTitle =
    article.title && article.title !== url.hostname
      ? article.title
      : (escalatedMeta?.title ?? article.title ?? url.hostname);

  return {
    title:
      cleanTitle(rawTitle, {
        siteName: article.siteName ?? null,
        hostname: url.hostname,
      }) || url.hostname,
    byline: cleanByline(article.byline),
    siteName: article.siteName || url.hostname,
    html,
    excerpt: article.excerpt || escalatedMeta?.description || null,
  };
}
