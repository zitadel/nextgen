import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { MetaCard } from "./detail-meta";
import { EYEBROW, PAGE_TITLE } from "./typography";

/**
 * Shared geometry for the console's resource detail screens (Users, Teams,
 * Project settings) — the detail counterpart of `resource-list.tsx`.
 *
 * One shell draws all three; its measurements live in "Resource detail layout"
 * in `docs/styling.md`, which a change to a value here updates too.
 *
 * The schema and login-flow screens are a different composition — the whole
 * screen is one panel ({@link DetailPanel}) — and keep it. Both share the icon
 * tile ({@link ICON_PLATE}); the login-flow screen also shares the header card
 * (`MetaCard`), while the schema screen shows no id.
 */

/** Page wrapper: the list shell's gutter, 22px under the navbar. */
export function DetailPage({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-5.5 pb-8">{children}</div>;
}

/** The 24px gap between the header row and the first body element. */
export const DETAIL_BODY = "mt-6";

/** A detail screen's title: the 24/24 display face. */
export const DETAIL_TITLE = PAGE_TITLE;

/** The icon tile a detail title leads with. */
export const ICON_PLATE =
  "bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md";

/** A body card: the stock `Card` with its own gap and padding removed. */
export const DETAIL_CARD = "gap-0 py-0";

/**
 * A body card with a titled section: the eyebrow, an optional action beside it,
 * an optional note under them, a rule, then `children`. Inset 24px, 20px top
 * and bottom, 16px between parts.
 */
export function DetailSection({
  title,
  titleId,
  action,
  note,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Card>, "title"> & {
  title: string;
  /** Sets the eyebrow's id, for a card labelled by it. */
  titleId?: string;
  action?: ReactNode;
  /** A line between the header and the rule. */
  note?: ReactNode;
}) {
  const eyebrow = (
    <span id={titleId} className={EYEBROW}>
      {title}
    </span>
  );
  return (
    <Card className={cn(DETAIL_CARD, className)} {...props}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        {action ? (
          <div className="flex items-center justify-between gap-4">
            {eyebrow}
            {action}
          </div>
        ) : (
          eyebrow
        )}
        {note}
        <Separator />
        {children}
      </CardContent>
    </Card>
  );
}

/** The single panel card of a configuration detail screen (`DETAIL_PANEL_PAGE`). */
export function DetailPanel({ children }: { children: ReactNode }) {
  return <Card className="gap-4 border-foreground/10 px-6 py-5 shadow-xs">{children}</Card>;
}

/** A panel's title lockup: the icon tile, an optional eyebrow, and the `h1`. */
export function PanelTitle({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
}) {
  const heading = <h1 className="truncate font-serif text-lg leading-6 text-foreground">{title}</h1>;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className={ICON_PLATE}>
        <Icon className="size-4" strokeWidth={1.5} />
      </span>
      {eyebrow ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={EYEBROW}>{eyebrow}</span>
          {heading}
        </div>
      ) : (
        heading
      )}
    </div>
  );
}

/**
 * A detail screen's header row: the title lockup on the left, the meta card on
 * the right.
 *
 * It wraps rather than overflows — the meta card's width is set by the id, so
 * when the title and the card do not fit on one line the card drops below
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
            <h1 className={cn(DETAIL_TITLE, "wrap-anywhere")}>{title}</h1>
            {status}
          </div>
          {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
        </div>
      </div>
      <MetaCard>{meta}</MetaCard>
    </div>
  );
}
