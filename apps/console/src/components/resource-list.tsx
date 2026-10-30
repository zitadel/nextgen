import { Ellipsis, type LucideIcon } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { LoadMoreState } from "@/hooks/use-load-more";
import { cn } from "@/lib/utils";

import { PAGE_TITLE, PAGE_TITLE_ROW } from "./typography";

/**
 * Shared geometry for the console's resource list screens (Users, Teams,
 * Projects).
 *
 * Every list screen draws the same shell:
 *
 * | Region        | Value                                              |
 * | ------------- | -------------------------------------------------- |
 * | Page          | `Page` (`layout.tsx`) — 16px gutter, 20px top at `lg` |
 * | Header gutter | 24px at `lg` — the page gutter plus 8px; 16px below  |
 * | Title row     | 36px with or without the Add button (`PAGE_TITLE_ROW`) |
 * | Table top     | 20px under the title row at `lg`, 16px below        |
 * | Table head    | 56px tall, 24px leading / 16px trailing inset       |
 * | Table cell    | 56px tall, 24px inset, 8px block padding            |
 * | Head label    | display face, 12/16, 0.72px tracking, `foreground`  |
 * | Row icon      | 16px, stroke 1.5, `muted-foreground`, 10px to label |
 *
 * Column widths stay with each screen: Teams is a fixed 248px grid, while the
 * Users and Projects tables let their ID column take the slack
 * (`ResourceIdCell`); Users takes the properties a viewer pins, so it has no
 * fixed grid to share.
 */

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
 * its primary action beside it at every width (D19), and any filter beside
 * that. 36px tall (`PAGE_TITLE_ROW`), except on a phone with a filter, where
 * the filter takes a second row under the title.
 */
export function ResourceTitle({
  children,
  action,
  filter,
}: {
  children: ReactNode;
  action?: ReactNode;
  /**
   * Controls that narrow the list, beside the action and 8px from it. On a
   * phone they drop to their own row under the title while the action keeps
   * the title row (D19).
   */
  filter?: ReactNode;
}) {
  return (
    <div className={cn(RESOURCE_HEADER, PAGE_TITLE_ROW, "flex-wrap gap-x-2 gap-y-4")}>
      <h1 className={RESOURCE_TITLE}>{children}</h1>
      {filter && (
        <div className="order-3 flex basis-full items-center gap-2 sm:order-2 sm:ml-auto sm:basis-auto">
          {filter}
        </div>
      )}
      <div className="order-2 ml-auto sm:order-3 sm:ml-0">{action}</div>
    </div>
  );
}

/** The card the table sits on. */
export const RESOURCE_TABLE_WRAP =
  "border-sidebar-border bg-card overflow-x-auto rounded-md border";

/**
 * The card of a table whose leading and trailing columns stay put while the
 * rest scrolls under them. It is the `scroll` group the sticky cells read
 * `data-scroll-start` / `data-scroll-end` from (`useScrollEdges`).
 */
export const RESOURCE_TABLE_SCROLL = "group/scroll";

/**
 * The leading column, pinned to the card's left edge from 640px. Its 1px
 * divider shows only while a column is scrolled under it.
 *
 * Below 640px it scrolls with the rest: a phone's card is about 300px wide,
 * and a pinned identity column (up to 280px) beside the pinned menu would
 * leave no room for any column between them.
 */
export const RESOURCE_STICKY_START =
  "sm:sticky sm:left-0 sm:z-10 bg-card sm:group-data-[scroll-start]/scroll:shadow-[inset_-1px_0_0_var(--color-border)]";

/**
 * The trailing column (the row menu), pinned to the card's right edge so the
 * menu is reachable at any width. Its divider shows while columns run on
 * under it.
 */
export const RESOURCE_STICKY_END =
  "sticky right-0 z-10 bg-card group-data-[scroll-end]/scroll:shadow-[inset_1px_0_0_var(--color-border)]";

/**
 * A body cell of a sticky column. It must be opaque, or the scrolled cells
 * show through it, so the row's translucent hover and open-menu fills
 * (`ResourceRow`, `TableRow`) are mixed onto the card colour here rather than
 * layered over it. The row needs the `group` class. It fades with the row's
 * own `transition-colors`, or it would snap while the rest of the row fades.
 */
export const RESOURCE_STICKY_BODY =
  "transition-colors bg-card group-hover:bg-[color-mix(in_oklab,var(--color-muted)_40%,var(--color-card))] group-has-aria-expanded:bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))]";

/** One body cell: 56px tall, inset 24px. */
export const RESOURCE_CELL = "h-14 px-6 py-2";

/** A body cell holding secondary text. */
export const RESOURCE_CELL_MUTED = "text-muted-foreground h-14 truncate px-6 py-2 text-sm";

// The row's copy button rests hidden and shows on the row's hover or its own
// focus, so a keyboard reaches it; where there is no hover it always shows.
// The row needs the `group` class for the hover.
const ROW_COPY =
  "shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * A row's ID cell. It takes whatever width the other columns leave
 * (`w-full max-w-0`) and truncates inside it, so a table of a few short
 * columns fits a 1024px window without scrolling. The tooltip keeps the whole
 * id, and the copy button copies it however much of it shows.
 */
export function ResourceIdCell({ id, name }: { id: string; name: string }) {
  return (
    <TableCell className={`${RESOURCE_CELL} w-full max-w-0 min-w-40`}>
      <span className="flex items-center gap-1">
        <span className="text-foreground min-w-0 truncate text-sm" title={id}>
          {id}
        </span>
        <CopyButton value={id} label={`Copy the ID of ${name}`} className={ROW_COPY} />
      </span>
    </TableCell>
  );
}

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
  size = "icon",
  className,
  contentClassName = "w-40",
  children,
}: {
  /** The row's name, for the trigger's accessible name. */
  name: string;
  icon?: LucideIcon;
  /** `icon-xs`: the 24px trigger a detail card's rows draw. */
  size?: "icon" | "icon-xs";
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
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
