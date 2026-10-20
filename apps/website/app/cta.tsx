import { links } from "./links";
import { GitHubMark } from "./github-mark";

const BUTTON =
  "group inline-flex h-11 items-center gap-2 rounded-lg px-5 font-semibold text-sm transition-colors";

/**
 * The page's two ways on, under the hero and at the end of the steps: the
 * quickstart, the one thing to do next, and the code.
 */
export function CallToAction({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      <a
        href={links.quickstart}
        className={`${BUTTON} bg-text-primary text-background hover:opacity-85`}
      >
        Read the quickstart
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        >
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
      <a
        href={links.github}
        className={`${BUTTON} border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]`}
      >
        <GitHubMark className="size-4" />
        View on GitHub
      </a>
    </div>
  );
}
