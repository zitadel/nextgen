import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { rehypeCode, remarkGfm, remarkHeading } from "fumadocs-core/mdx-plugins";

import { getMDXComponents } from "@/components/mdx";
import { codeThemes } from "@/lib/code-theme";

// A reference page written as Markdown (lib/markdown.ts), rendered with the
// plugins and the components the MDX pages are: GitHub tables, headings with
// the anchors the page's table of contents links to, and code in the
// console's colours.
const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [[rehypeCode, { themes: codeThemes }]],
});

// A table's first column names a flag, an argument or a command, which reads
// as one line: `--non-interactive` broken at its hyphen does not.
export function MarkdownPage({ markdown }: { markdown: string }) {
  return (
    <div className="[&_td:first-child_code]:whitespace-nowrap">
      <MarkdownServer components={getMDXComponents()}>{markdown}</MarkdownServer>
    </div>
  );
}
