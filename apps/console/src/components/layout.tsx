import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one page wrapper every console screen renders in — lists, resource
 * details, configuration panels, settings and System alike — so every screen
 * starts the same distance under the top bar and the shell's <main> stays
 * padding-free.
 *
 * | Region      | Value                                              |
 * | ----------- | -------------------------------------------------- |
 * | Page top    | 20px at `lg`, 16px below                            |
 * | Page gutter | 16px; 24px from `sm` for a configuration panel      |
 * | Page bottom | 32px                                                |
 *
 * `inset="panel"` is the schema / login-flow / IdP composition, whose single
 * panel card the design insets by 24px on the sides. Only the sides differ: the
 * top is the same for every screen, which is the point of the component.
 *
 * Do not write Tailwind's built-in centring utility name (the "c" word) anywhere
 * in scanned source, even in a comment: its extractor would emit that utility,
 * whose max-width tiers reference the var()-based --zl-breakpoint-* tokens inside
 * an @media condition, which lightningcss cannot minify and the build fails.
 */
export function Page({
  children,
  inset = "default",
}: {
  children: ReactNode;
  inset?: "default" | "panel";
}) {
  return <div className={cn(PAGE, inset === "panel" && "sm:px-6")}>{children}</div>;
}

const PAGE = "px-4 pt-4 pb-8 lg:pt-5";

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
