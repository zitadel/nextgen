"use client";

import { type Placement, trackEvent } from "./analytics";
import { links } from "./links";
import { GitHubMark } from "./github-mark";

const BUTTON =
  "group inline-flex h-11 items-center gap-2 rounded-lg px-5 font-semibold text-sm transition-colors";
const FILLED = "bg-text-primary text-background hover:opacity-85";
const OUTLINED =
  "border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]";

/**
 * The page's ways on beside its commands: the quickstart and the code. Under
 * the hero's commands, `quiet` keeps to the quickstart, outlined, so the
 * commands stay the first thing to do. A click reports `clicked_link` with
 * `placement` (analytics.ts): page views cannot say which page sent a visitor
 * to the quickstart, and GitHub is another site.
 */
export function CallToAction({
  placement,
  quiet = false,
  className = "",
}: {
  placement: Placement;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      <a
        href={links.quickstart}
        onClick={() => trackEvent("clicked_link", { target: "quickstart", placement })}
        className={`${BUTTON} ${quiet ? OUTLINED : FILLED}`}
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
      {!quiet && (
        <a
          href={links.github}
          onClick={() => trackEvent("clicked_link", { target: "github", placement })}
          className={`${BUTTON} ${OUTLINED}`}
        >
          <GitHubMark className="size-4" />
          View on GitHub
        </a>
      )}
    </div>
  );
}
