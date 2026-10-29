import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// The changelog entries' Markdown (GFM), rendered as elements on the server
// and never as HTML: this origin also serves the console and its session, so
// the HTML an entry holds is dropped (skipHtml), and so is every link or image
// URL but a relative, http(s) or mailto one (react-markdown's
// defaultUrlTransform). An entry's headings go under the page's: its h1 and h2
// one level below the heading it sits under, its h3 two, the rest three, at
// most h6.
const LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function headings(under: number): Components {
  const level = (depth: number) => LEVELS[Math.min(under + depth, 6) - 1] ?? "h6";
  return { h1: level(1), h2: level(1), h3: level(2), h4: level(3), h5: level(3) };
}

/**
 * Markdown in the changelog's type (`.release-notes` in globals.css), under a
 * heading of level `under`.
 */
export function Markdown({
  children,
  className = "",
  under = 3,
}: {
  children: string;
  className?: string;
  under?: number;
}) {
  return (
    <div className={`release-notes ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={headings(under)} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
