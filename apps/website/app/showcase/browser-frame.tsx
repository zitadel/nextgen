import type { ReactNode } from "react";
import { SEGMENTS, segment, Window } from "../window";

/**
 * A browser window around what a step produced (zitadel/new-website's
 * BrowserFrame): the address over `children`, the page; with `onToggle` a
 * Before / After switch that sets `showResult`, which the page follows;
 * `control` adds one more beside it.
 */
export function BrowserFrame({
  url,
  showResult,
  onToggle,
  control,
  children,
}: {
  url: string;
  showResult: boolean;
  onToggle?: (showResult: boolean) => void;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Window
      className="h-full"
      title={
        <span className="flex h-7 w-full max-w-[17rem] min-w-0 items-center justify-center gap-1.5 rounded-md bg-tint/[0.05] px-2 text-[0.6875rem] text-text-secondary sm:px-3 sm:text-xs">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="size-3 shrink-0 max-sm:hidden"
          >
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" opacity="0.7" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="truncate">{url}</span>
        </span>
      }
      end={
        (onToggle || control) && (
          <>
            {control}
            {onToggle && (
              <fieldset className={SEGMENTS}>
                <legend className="sr-only">Before or after the change</legend>
                <button
                  type="button"
                  aria-pressed={!showResult}
                  onClick={() => onToggle(false)}
                  className={segment(!showResult)}
                >
                  Before
                </button>
                <button
                  type="button"
                  aria-pressed={showResult}
                  onClick={() => onToggle(true)}
                  className={segment(showResult)}
                >
                  After
                </button>
              </fieldset>
            )}
          </>
        )
      }
    >
      {children}
    </Window>
  );
}
