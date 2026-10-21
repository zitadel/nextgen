import type { ReactNode } from "react";

// A window's sections' side padding, its body (padding and code type) and a
// strip under the body.
export const WINDOW_INSET = "px-5 md:px-6";
export const WINDOW_BODY = `${WINDOW_INSET} py-4 font-mono text-xs leading-5 md:py-5 md:text-[0.8125rem]`;
export const WINDOW_FOOTER = "border-window-border border-t bg-window-sunken";

// The three dots' width, and the spacer's that balances them: smaller on a
// phone, where the title needs the room.
const DOTS_WIDTH = "w-8 sm:w-[2.625rem]";
const DOT = "size-2 rounded-full bg-tint/10 sm:size-2.5";

/**
 * A title bar's button, as the copy button is wherever it stands: 28px high,
 * its edge showing on hover. Each adds its color.
 */
export const BAR_BUTTON =
  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 font-sans font-semibold text-xs leading-4 transition-colors hover:border-window-border hover:text-text-primary";

/** The inset track a segmented control's options sit in. */
export const SEGMENTS = "flex shrink-0 rounded-lg bg-tint/[0.05] p-0.5";

/**
 * One option of a segmented control in a window (the browser's Before /
 * After, the brand step's choices), at least 24px high, the smallest target
 * WCAG 2.2 asks for.
 */
export function segment(on: boolean): string {
  return `cursor-pointer rounded-md px-2 py-1 font-semibold text-xs leading-4 transition-colors sm:px-2.5 ${
    on ? "bg-tint/10 text-text-primary" : "text-text-muted hover:text-text-primary"
  }`;
}

/**
 * Every window on the page, the hero's terminal and the showcase's terminals,
 * editors and browsers: a raised surface with a hairline edge, lit from the
 * top, and a title bar of one height (h-11), so two windows side by side start
 * their content on one line. `title` fills the middle of the bar, a name
 * centered in it or a browser's address; `end` holds the window's controls. The body fills the
 * window, so windows stretched to one height keep their surface to the bottom.
 */
export function Window({
  title,
  end,
  children,
  className = "",
}: {
  title?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-window-border bg-window shadow-(--window-shadow) ${className}`}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-window-border border-b bg-window-bar px-3 sm:gap-3 sm:px-4">
        <Dots />
        <div className="flex min-w-0 flex-1 justify-center font-mono text-text-muted text-xs leading-4">
          {typeof title === "string" ? <span className="truncate">{title}</span> : title}
        </div>
        {/* Without controls, as wide as the dots, so the title sits centered. */}
        {end ? (
          <div className="flex shrink-0 items-center gap-2">{end}</div>
        ) : (
          <span aria-hidden="true" className={`${DOTS_WIDTH} shrink-0`} />
        )}
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/** The three dots of a title bar. */
function Dots() {
  return (
    <span aria-hidden="true" className={`flex ${DOTS_WIDTH} shrink-0 gap-1 sm:gap-1.5`}>
      <span className={DOT} />
      <span className={DOT} />
      <span className={DOT} />
    </span>
  );
}
