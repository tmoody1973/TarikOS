import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";

// Server-side article extraction for the reader pane: fetch a source URL,
// run Firefox's Readability parser, sanitize the result down to a tight
// tag allowlist so it's safe to render with dangerouslySetInnerHTML.

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

export async function extractArticle(rawUrl: string): Promise<ReaderArticle> {
  const url = assertSafeUrl(rawUrl);

  const res = await fetch(url, {
    headers: {
      // Some publishers serve bots an empty shell; present as a browser.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      // jsdom's globals break undici's automatic response decompression in
      // this process, so ask the server for an uncompressed body outright.
      "accept-encoding": "identity",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new ReaderError(`The site answered ${res.status}.`);
  }
  const rawHtml = (await res.text()).slice(0, 3_000_000);
  // Body sniff instead of a content-type check: jsdom's globals make
  // res.headers.get() unreliable in the same process, and Readability
  // needs HTML regardless of what the header claims.
  if (!/<(!doctype|html|body|article|div)[\s>]/i.test(rawHtml.slice(0, 2000))) {
    throw new ReaderError("That link isn't an article page.");
  }

  const virtualConsole = new VirtualConsole(); // swallow CSS-parse noise
  const dom = new JSDOM(rawHtml, { url: url.href, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  if (!article?.content || (article.textContent ?? "").trim().length < 200) {
    throw new ReaderError("Couldn't extract readable text from that page.");
  }

  const html = sanitizeHtml(article.content, {
    allowedTags: [
      "p", "h1", "h2", "h3", "h4", "a", "ul", "ol", "li", "blockquote",
      "em", "strong", "b", "i", "code", "pre", "figure", "figcaption",
      "img", "br", "hr", "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["https", "http"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noreferrer",
      }),
    },
  });

  return {
    title: article.title || url.hostname,
    byline: article.byline || null,
    siteName: article.siteName || url.hostname,
    html,
    excerpt: article.excerpt || null,
  };
}
