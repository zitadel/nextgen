import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared geometry for the console's resource detail screens (Users, Teams,
 * Project settings) — the detail counterpart of `resource-list.tsx`.
 *
 * The three screens had each measured "the detail frame" and landed on three
 * versions of it. One shell now draws all of them; its measurements live in
 * one place, "Resource detail layout" in `docs/styling.md`, which a change to
 * a value here updates too.
 *
 * The schema and login-flow screens are a different composition — the whole
 * screen is one panel (`DETAIL_PANEL_PAGE`) — and keep it. Both share the icon
 * tile ({@link ICON_PLATE}); the login-flow screen also shares the header card
 * ({@link MetaCard}), while the schema screen shows no id.
 */

/** Page wrapper: the list shell's gutter, 22px under the navbar. */
export function DetailPage({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-[22px] pb-8">{children}</div>;
}

/** The 24px gap between the header row and the first body element. */
export const DETAIL_BODY = "mt-6";

/** The icon tile a detail title leads with. */
export const ICON_PLATE =
  "bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md";

/**
 * The card of labelled values (`MetaValue`, split by `MetaRule`) that identifies
 * a resource: stacked below `sm`, where the rule becomes a tick on its own row,
 * and in a row above it.
 *
 * `max-w-full` + `overflow-x-auto`: its width is set by the id, which is never
 * truncated, so a narrow screen scrolls the card rather than the page.
 */
export function MetaCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("max-w-full gap-0 overflow-x-auto rounded-xl py-0", className)}>
      <CardContent className="flex flex-col px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * A detail screen's header row: the title lockup on the left, the meta card on
 * the right.
 *
 * It wraps rather than overflows — the meta card's width is set by the id, so
 * when the title and the card no longer fit on one line the card drops below
 * instead of pushing off the page edge.
 */
export function DetailHeader({
  icon: Icon,
  title,
  status,
  subtitle,
  meta,
}: {
  icon: LucideIcon;
  title: string;
  /** Beside the title, e.g. a `StatusBadge`. */
  status?: ReactNode;
  /** A second identity line under the title, e.g. a user's identifier. */
  subtitle?: string;
  /** The `MetaValue`s for the header card. */
  meta: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 px-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className={ICON_PLATE}>
          <Icon className="size-4" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {/* `wrap-anywhere`, not `break-words`: only `anywhere` lowers the
                flex item's minimum width, so a title with no break point — a
                user's email address — wraps on a phone instead of widening the
                page past the viewport. */}
            <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight wrap-anywhere">
              {title}
            </h1>
            {status}
          </div>
          {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
        </div>
      </div>
      <MetaCard>{meta}</MetaCard>
    </div>
  );
}
