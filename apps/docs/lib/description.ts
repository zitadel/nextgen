import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { remark } from "remark";

// An operation's or a webhook's OpenAPI description is long-form Markdown,
// written for the page's body, which shows all of it. Everything else about
// the page wants a line of plain text: its entry in llms.txt and MCP's
// list_pages get the description's first sentence (firstSentence), the meta
// and Open Graph description and the line under the title on the Open Graph
// image the same sentence cut at a word past what search results and the image
// have room for (shortDescription). So an operation's first sentence must say
// on its own what the operation does (api/openapi/AGENTS.md); the page's
// header is its title alone.
//
// lib/source.ts keeps the whole description beside the short one, as the
// page's `markdownDescription`, for the page's Markdown and for search.

const maxLength = 160;

// The parser the page's body renders the description with (fumadocs-openapi's
// Markdown renderer), so the sentence is read from the text the reader sees.
const parser = remark().use(remarkGfm);

// A sentence ends at a full stop, question or exclamation mark, and any
// closing quote or bracket after it ('"Active."', '(see below.)'), that is
// followed by a space and something other than a lower-case letter: a
// capital, a quote ('"Active" here means'), a code span, a digit. These
// abbreviations end in a full stop but not a sentence.
const sentenceEnd =
  /(?<!\b(?:[Ee]\.g|[Ii]\.e|[Cc]f|[Vv]s|[Aa]pprox|[Ii]ncl))[.!?]["'’”)\]]*(?= +[^a-z ])/;

/** The first sentence of the description's first paragraph, as plain text. */
export function firstSentence(markdown: string) {
  const paragraph = parser.parse(markdown).children.find((node) => node.type === "paragraph");
  if (!paragraph) return "";

  // `text` is what the reader sees; `masked` is the same length, with every
  // full stop that cannot end a sentence hidden: a code span's text is literal
  // (`GET /users. Then`), and a link is one phrase.
  let text = "";
  let masked = "";
  const append = (value: string, literal: boolean) => {
    text += value;
    masked += literal ? value.replace(/[.!?]/g, "X") : value;
  };
  const walk = (node: Inline, literal: boolean): void => {
    switch (node.type) {
      case "text":
        append(node.value, literal);
        return;
      // A code span starts a sentence like a word: "revision. `GET /idps` lists".
      case "inlineCode":
        append(node.value, true);
        return;
      case "image":
        append(node.alt ?? "", literal);
        return;
      case "break":
        append(" ", literal);
        return;
      case "link":
      case "linkReference":
        for (const child of node.children) walk(child, true);
        return;
      default:
        if ("children" in node) for (const child of node.children) walk(child, literal);
    }
  };
  for (const child of paragraph.children) walk(child, false);

  // The masking keeps the whitespace where it is, so the two stay aligned.
  text = text.replace(/\s+/g, " ").trim();
  masked = masked.replace(/\s+/g, " ").trim();
  const end = sentenceEnd.exec(masked);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

/** The first sentence, cut at a word if it is longer than 160 characters. */
export function shortDescription(markdown: string) {
  const sentence = firstSentence(markdown);
  if (sentence.length <= maxLength) return sentence;
  return `${sentence
    .slice(0, maxLength)
    .replace(/\s+\S*$/, "")
    .replace(/[,;:]$/, "")}…`;
}

type Inline = Extract<
  ReturnType<typeof parser.parse>["children"][number],
  { type: "paragraph" }
>["children"][number];
