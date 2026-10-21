import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// The release notes' Markdown as GitHub writes it (GFM), rendered as elements
// on the server and never as HTML: this origin also serves the console and
// its session, so the HTML a note holds is dropped (skipHtml), and so is
// every link or image URL but a relative, http(s) or mailto one
// (react-markdown's defaultUrlTransform). The page's outline already has the
// release (h2) and its kinds of change (h3), so a note's headings start at h4.
const components: Components = {
  h1: "h4",
  h2: "h4",
  h3: "h5",
  h4: "h6",
  h5: "h6",
};

/** Markdown in the changelog's type (`.release-notes` in globals.css). */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`release-notes ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
