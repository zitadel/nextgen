import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one page wrapper every console screen renders in, so every screen starts
 * the same distance under the top bar. Its geometry, and `inset="panel"` for
 * the configuration-panel screens, are in `docs/styling.md` ("Page wrapper").
 *
 * Do not write Tailwind's built-in centring utility name (the "c" word) anywhere
 * in scanned source, even in a comment: its extractor would emit that utility,
 * whose max-width tiers reference the var()-based --zl-breakpoint-* tokens inside
 * an @media condition, which lightningcss cannot minify and the build fails.
 */
export function Page({
  children,
  inset = "default",
  fill = false,
}: {
  children: ReactNode;
  inset?: "default" | "panel";
  /**
   * On a desktop, exactly the height under the 56px top bar, as a column, so a
   * child with `flex-1 min-h-0` takes what is left instead of guessing it from
   * `100vh` (Branding's preview). Content too tall for it still spills over
   * and the page scrolls, so a short window keeps its minimum heights.
   */
  fill?: boolean;
}) {
  return (
    <div className={cn(PAGE, inset === "panel" && "sm:px-6", fill && PAGE_FILL)}>{children}</div>
  );
}

const PAGE = "px-4 pt-4 pb-8 lg:pt-5";
const PAGE_FILL = "lg:flex lg:h-[calc(100svh-3.5rem)] lg:flex-col";

/** The fixed column every settings screen renders in, centred in the main area. */
export function SettingsColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-(--zl-container-settings)">{children}</div>;
}

/**
 * 12-column content grid with a 24px gutter. Column count
 * is hard-coded as `grid-cols-12` because CSS does not allow a `var()` as the
 * `repeat()` count. Collapses to a single column below `md`.
 */
export function ContentGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid grid-cols-1 gap-6 md:grid-cols-12 ${className}`}>{children}</div>;
}
