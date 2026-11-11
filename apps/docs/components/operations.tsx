import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { remarkGfm } from "fumadocs-core/mdx-plugins";

import { getMDXComponents } from "@/components/mdx";

// An API tag's operations, the Markdown tables its Markdown has too
// (operationTable in lib/source.ts), rendered with the MDX pages' components.
const { MarkdownServer } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

// A first cell is a method or an event type, which reads as one line.
export function Operations({ markdown }: { markdown: string }) {
  return (
    <div className="[&_td:first-child_code]:whitespace-nowrap">
      <MarkdownServer components={getMDXComponents()}>{markdown}</MarkdownServer>
    </div>
  );
}
