import { Ellipsis, type LucideIcon } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { LoadMoreState } from "@/hooks/use-load-more";
import { cn } from "@/lib/utils";

import { PAGE_TITLE } from "./typography";

/**
 * Shared geometry for the console's resource list screens (Users, Teams,
 * Projects).
 *
 * Every list screen draws the same shell:
 *
 * | Region        | Value                                              |
 * | ------------- | -------------------------------------------------- |
 * | Page gutter   | 16px — the table's own inset                        |
 * | Page top      | 20px at `lg`, 16px below — the page-header block    |
 * | Header gutter | 24px at `lg` — the page gutter plus 8px; 16px below  |
 * | Title row     | 24px, or 36px with the Add button beside the title  |
 * | Table top     | 20px under the title row at `lg`, 16px below        |
 * | Table head    | 56px tall, 24px leading / 16px trailing inset       |
 * | Table cell    | 56px tall, 24px inset, 8px block padding            |
 * | Head label    | display face, 12/16, 0.72px tracking, `foreground`  |
 * | Row icon      | 16px, stroke 1.5, `muted-foreground`, 10px to label |
 *
 * Column widths stay with each screen: Teams is a fixed 248px grid, Projects
 * thirds, and the Users table is schema-driven and scrolls horizontally, so it
 * has no fixed grid to share.
 */

/** Page gutters. `ResourcePage` adds the page-header block's top padding. */
export const RESOURCE_PAGE = "px-4 pb-8";

/** Page wrapper for a list screen: 20px under the navbar at `lg`, 16px below. */
export function ResourcePage({ children }: { children: ReactNode }) {
  return <div className={cn(RESOURCE_PAGE, "pt-4 lg:pt-5")}>{children}</div>;
}

/**
 * Title row. The page header block insets 24px at `lg` (the page gutter plus
 * 8px) and 16px below it, where it sits flush with the table.
 */
export const RESOURCE_HEADER = "px-0 lg:px-2";

/** The table's distance from the title row. */
export const RESOURCE_TABLE_TOP = "mt-4 lg:mt-5";

/**
 * A table on a fractional grid. Below 576px the card scrolls it sideways, as
 * the Users table scrolls, rather than squeezing the columns into cells too
 * narrow to read; the design draws no narrow variant of these tables.
 */
export const RESOURCE_TABLE_FIXED = "min-w-[36rem] table-fixed text-xs";

/** A screen's title: the 24/24 display face, shared with the detail shell. */
export const RESOURCE_TITLE = PAGE_TITLE;

/**
 * The title row of a list screen: the heading with, where the screen has one,
 * its primary action beside it at every width (D19). 24px tall on its own,
 * 36px with the button.
 */
export function ResourceTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn(RESOURCE_HEADER, "flex min-h-6 items-center justify-between gap-3")}>
      <h1 className={RESOURCE_TITLE}>{children}</h1>
      {action}
    </div>
  );
}

/** The card the table sits on. */
export const RESOURCE_TABLE_WRAP =
  "border-sidebar-border bg-card overflow-x-auto rounded-md border";

/** One body cell: 56px tall, inset 24px. */
export const RESOURCE_CELL = "h-14 px-6 py-2";

/** A body cell holding secondary text. */
export const RESOURCE_CELL_MUTED = "text-muted-foreground h-14 truncate px-6 py-2 text-sm";

/** A row's leading glyph — the design draws Lucide at stroke 1.5, not the default 2. */
export const RESOURCE_ROW_ICON = "text-muted-foreground size-4 shrink-0";

/** The link in a row's first cell, with the design's 10px icon gap. */
export const RESOURCE_ROW_LINK =
  "text-foreground inline-flex items-center gap-2.5 truncate text-sm font-medium underline-offset-2 hover:underline";

/**
 * Whether a click on a resource row should open it.
 *
 * The row is a pointer affordance layered over a real link, and the link owns
 * the modified clicks: cmd/ctrl-click opens a new tab, and letting the row
 * handler run as well would navigate the current one at the same time. A click
 * that lands on any interactive child belongs to that child.
 */
export function opensRow(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  // `target` is typed `EventTarget`, and only an `Element` can be an interactive
  // child or answer `closest`. Anything else is the row's own click to take,
  // rather than a reason to throw.
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest("a, button, input, select, textarea, [role='menuitem']");
}

/** The table's header row: a hairline under it, no hover fill. */
export function ResourceHeaderRow({ children }: { children: ReactNode }) {
  return <TableRow className="border-border border-b hover:bg-transparent">{children}</TableRow>;
}

/**
 * Column header: plain text in the display face, with no button geometry
 * around it.
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

/** The empty header cell over the row menus. */
export function ResourceMenuHead({ className }: { className?: string }) {
  return <TableHead className={cn("h-14 px-6", className)} />;
}

/**
 * A body row. With `onOpen` the whole row is a pointer target for its
 * first-cell link, and `opensRow` keeps it out of that link's way.
 */
export function ResourceRow({
  onOpen,
  className,
  ...props
}: ComponentProps<typeof TableRow> & { onOpen?: () => void }) {
  return (
    <TableRow
      className={cn("hover:bg-muted/40 border-0", onOpen && "cursor-pointer", className)}
      onClick={
        onOpen &&
        ((event) => {
          if (opensRow(event)) onOpen();
        })
      }
      {...props}
    />
  );
}

/** The single row a table shows when it has nothing to list. */
export function ResourceEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow className="border-0 hover:bg-transparent">
      <TableCell colSpan={colSpan} className="text-muted-foreground h-24 text-center">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** A row's actions menu: a ghost icon button opening a dropdown of `children`. */
export function RowMenu({
  name,
  icon: Icon = Ellipsis,
  className,
  contentClassName = "w-40",
  children,
}: {
  /** The row's name, for the trigger's accessible name. */
  name: string;
  icon?: LucideIcon;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${name}`}
          className={className}
        >
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={contentClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * `Load more` under a cursor-paginated list (decisions log D5: a button, not
 * pagination controls). Its presence means there is more; its absence means the
 * list is complete.
 */
export function LoadMore({ paging }: { paging: LoadMoreState }) {
  return (
    <>
      <FormError message={paging.error} className="mt-3" />
      {paging.hasMore && (
        <Button
          variant="secondary"
          className="mt-6 h-9 w-full gap-1.5 px-2.5"
          onClick={() => void paging.loadMore()}
          loading={paging.loading}
        >
          Load more
        </Button>
      )}
    </>
  );
}
