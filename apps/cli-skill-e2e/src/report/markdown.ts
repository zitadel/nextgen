import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "b",
  "i",
  "s",
  "del",
  "code",
  "pre",
  "kbd",
  "blockquote",
  "a",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
] as const;

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: { a: ["href", "title"], th: ["align"], td: ["align"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
};

/**
 * Agent and user text is model output, not trusted HTML: `marked` passes raw
 * HTML through, and the report opens itself in a browser, so an unsanitised
 * transcript could run script in the local file origin. Render the markdown,
 * then strip everything that is not a safe formatting tag.
 */
export function markdownToHtml(text: string | undefined): string {
  return sanitizeHtml(marked.parse(text ?? "", { gfm: true, async: false }), SANITIZE);
}
