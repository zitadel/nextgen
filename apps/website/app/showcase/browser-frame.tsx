import type { ReactNode } from "react";
import { GradientBorder, TITLE_BAR, WindowDots } from "../gradient-border";

// Each half of the switch is at least 24px high, the smallest target WCAG 2.2
// asks for.
const SWITCH = "cursor-pointer rounded px-2.5 py-1 transition-colors";
const SWITCH_ON = "bg-surface-black-secondary text-text-primary";
const SWITCH_OFF = "text-text-secondary hover:text-text-primary";

/**
 * A browser window around what a row produced (zitadel/new-website's
 * BrowserFrame): the address over `children`, the page, and with `onToggle` a
 * Before / After switch that sets `showResult`, which the page follows.
 */
export function BrowserFrame({
  url,
  showResult,
  onToggle,
  children,
}: {
  url: string;
  showResult: boolean;
  onToggle?: (showResult: boolean) => void;
  children: ReactNode;
}) {
  return (
    <GradientBorder className="overflow-hidden">
      {/* On a phone the address and the switch need the dots' room: the
          address fits from 360px wide, and narrower ends in an ellipsis. */}
      <div className={`${TITLE_BAR} gap-3 pr-2.5 pl-2.5 sm:pl-4`}>
        <WindowDots className="max-sm:hidden" />
        <span className="flex h-7 min-w-0 flex-1 items-center justify-center rounded-md bg-surface-black-secondary px-2 font-mono text-[0.6875rem] text-text-secondary leading-4 sm:px-3 sm:text-xs">
          <span className="truncate">{url}</span>
        </span>
        {onToggle && (
          <fieldset className="flex shrink-0 rounded-md border border-border-secondary p-px font-semibold text-xs leading-4">
            <legend className="sr-only">Before or after the change</legend>
            <button
              type="button"
              aria-pressed={!showResult}
              onClick={() => onToggle(false)}
              className={`${SWITCH} ${showResult ? SWITCH_OFF : SWITCH_ON}`}
            >
              Before
            </button>
            <button
              type="button"
              aria-pressed={showResult}
              onClick={() => onToggle(true)}
              className={`${SWITCH} ${showResult ? SWITCH_ON : SWITCH_OFF}`}
            >
              After
            </button>
          </fieldset>
        )}
      </div>
      {children}
    </GradientBorder>
  );
}
