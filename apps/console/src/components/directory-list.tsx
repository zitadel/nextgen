import type { ReactNode } from "react";

import { RowMenu } from "@/components/resource-list";
import { Card } from "@/components/ui/card";

/** The card a directory's rows sit in. Rows carry their own `px-6`, so the dividers are full-bleed. */
export function DirectoryCard({
  empty,
  children,
}: {
  /** Shown instead of rows when there are none. */
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="mt-3 gap-0 overflow-hidden border-foreground/10 py-0 shadow-xs">
      {empty ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        children
      )}
    </Card>
  );
}

/** The stretched link that makes a whole directory row the click target. */
export const DIRECTORY_ROW_LINK =
  "font-serif text-base leading-6 text-foreground opacity-90 group-hover:opacity-100 after:absolute after:inset-0";

/**
 * `InlineCode` rests on `muted`, which equals the row's `accent` hover in the
 * light theme, so a chip lifts to `card` while its row is hovered.
 */
export const DIRECTORY_CHIP = "group-hover:bg-card";

/**
 * One row of a directory (user schemas, login flows).
 *
 * The whole row is the click target and hover is the affordance: the title's
 * stretched link (`DIRECTORY_ROW_LINK`) keeps one focusable control for the
 * destination, so anything else interactive sits above it with `relative z-10`.
 * Below `lg` the columns stack.
 */
export function DirectoryRow({
  name,
  title,
  caption,
  chips,
  children,
  menu,
}: {
  /** The row's name, for the menu's accessible name. */
  name: string;
  /** The stretched link, with any badge beside it. */
  title: ReactNode;
  /** The icon-led line under the title. */
  caption?: ReactNode;
  chips: ReactNode;
  /** The metadata columns between the chips and the menu. */
  children: ReactNode;
  /** The row menu's items. */
  menu: ReactNode;
}) {
  return (
    <div className="group relative flex flex-col gap-4 border-b border-border px-6 py-3.5 last:border-b-0 hover:bg-accent lg:flex-row lg:items-center lg:gap-6">
      <div className="flex shrink-0 flex-col gap-1 lg:min-w-55">
        {title}
        {caption && (
          <span className="flex items-center gap-1 text-xs leading-4 font-medium text-muted-foreground">
            {caption}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5">{chips}</div>

      {children}

      {/* Above the stretched link, or it swallows the menu's clicks. */}
      <div className="absolute top-3.5 right-4 lg:relative lg:top-auto lg:right-auto">
        <RowMenu name={name} className="relative z-10 opacity-50 group-hover:opacity-100">
          {menu}
        </RowMenu>
      </div>
    </div>
  );
}
