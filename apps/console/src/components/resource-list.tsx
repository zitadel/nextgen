import type { ReactNode } from "react";

import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Shared geometry for the console's resource list screens (Users, Teams,
 * Projects).
 *
 * Every list frame draws the same shell, and the three screens had drifted into
 * three versions of it — different page gutters, different cell padding, a
 * header label wrapped in a ghost-button-shaped span on one screen and not the
 * others. The numbers below are the ones measured off the Teams and Projects
 * hand-off frames and confirmed with a full-frame pixel diff:
 *
 * | Region        | Value                                              |
 * | ------------- | -------------------------------------------------- |
 * | Page gutter   | 16px — the table's own inset                        |
 * | Header gutter | 24px — the page gutter plus 8px                     |
 * | Table head    | 56px tall, 24px leading / 16px trailing inset       |
 * | Table cell    | 56px tall, 24px inset, 8px block padding            |
 * | Head label    | display face, 12/16, 0.72px tracking, `foreground`  |
 * | Row icon      | 16px, stroke 1.5, `muted-foreground`, 10px to label |
 *
 * Column widths stay with each screen: Teams is a fixed 248px grid, Projects
 * thirds, and the Users table is schema-driven and scrolls horizontally, so it
 * has no fixed grid to share.
 */

/** Page wrapper. Vertical padding varies by frame, so it is passed in. */
export const RESOURCE_PAGE = "px-4 pb-8";

/** Title row — the page gutter plus 8px, per the frames' page header. */
export const RESOURCE_HEADER = "px-2";

/** The card the table sits on. */
export const RESOURCE_TABLE_WRAP =
  "border-sidebar-border bg-card overflow-x-auto rounded-2xl border";

/** One body cell: 56px tall, inset 24px. */
export const RESOURCE_CELL = "h-14 px-6 py-2";

/** A row's leading glyph — the design draws Lucide at stroke 1.5, not the default 2. */
export const RESOURCE_ROW_ICON = "text-muted-foreground size-4 shrink-0";

/** The link in a row's first cell, with the design's 10px icon gap. */
export const RESOURCE_ROW_LINK =
  "text-foreground inline-flex items-center gap-[10px] truncate text-sm font-medium underline-offset-2 hover:underline";

/**
 * Column header. Plain text in the display face — deliberately not wrapped in a
 * span with button geometry, which is what inset one screen's labels by a
 * further 10px and greyed them to `muted-foreground`.
 */
export function ResourceHeadCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <TableHead
      className={cn(
        "text-foreground h-14 py-0 pr-4 pl-6 align-middle font-serif text-xs leading-4 tracking-[0.72px] uppercase",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}
