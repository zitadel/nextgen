import { getTableOfContents } from "fumadocs-core/content/toc";
import { remarkGfm, type StructuredData, structure } from "fumadocs-core/mdx-plugins";
import type { TOCItemType } from "fumadocs-core/toc";

// The reference pages written as Markdown, the CLI's (lib/cli-reference.ts)
// and the API's Errors page (lib/error-reference.ts): the same text for the
// page (components/markdown-page.tsx), its Markdown twin and search.

/**
 * Plain text with code in backticks, as Markdown. Outside a code span, a `*`
 * and a `<` that would open an HTML tag stay what they are.
 */
export function text(value: string) {
  return value
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\*|<(?=[A-Za-z/!?])/g, "\\$&")))
    .join("");
}

export type MarkdownPageData = {
  title: string;
  description: string;
  /** The page as Markdown, for the page itself, its Markdown twin and the MCP server. */
  markdown: string;
  /** The page in llms-full.txt, which leaves the operations out and so links none. */
  llmsFullMarkdown: string;
  toc: TOCItemType[];
  structuredData: StructuredData;
};

export function markdownPageData(
  title: string,
  description: string,
  markdown: string,
  llmsFullMarkdown = markdown,
): MarkdownPageData {
  return {
    title,
    description,
    markdown,
    llmsFullMarkdown,
    toc: getTableOfContents(markdown),
    // Search indexes the tables' cells, which the parser finds with GFM only.
    structuredData: structure(markdown, [remarkGfm]),
  };
}
