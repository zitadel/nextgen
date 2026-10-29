import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

import { MetaCard } from "./detail-meta";
import { EYEBROW, SECTION_HEADING, PAGE_TITLE } from "./typography";

/**
 * Shared geometry for the console's resource detail screens (Users, Teams,
 * Project settings) — the detail counterpart of `resource-list.tsx`.
 *
 * One shell draws all three; its measurements live in "Resource detail layout"
 * in `docs/styling.md`, which a change to a value here updates too.
 *
 * The user-schema screen heads the same body with {@link DetailTitle}: the
 * title over one line of identity, with no icon tile or meta card. The
 * login-flow, identity-provider and release screens are a different
 * composition — the whole screen is one panel ({@link DetailPanel}) — and keep
 * it. They share the icon tile ({@link ICON_PLATE}) and the header card
 * (`MetaCard`) with the resource screens.
 */

/** The 24px gap between the header row and the first body element. */
export const DETAIL_BODY = "mt-6";

/** A detail screen's title: the 24/24 display face. */
export const DETAIL_TITLE = PAGE_TITLE;

/** The icon tile a detail title leads with. */
export const ICON_PLATE =
  "bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md";

/** A card's or tab row's small action: 12px text, a 14px glyph. */
export const CARD_ACTION_BUTTON = "gap-1 px-2.5 text-xs [&_svg]:size-3.5!";

/** A body card: the stock `Card` with its own gap and padding removed. */
export const DETAIL_CARD = "gap-0 py-0";

/**
 * A body card with a titled section: the title (an `h2` in `SECTION_HEADING`), an
 * optional action beside it, an optional note under them, a rule, then
 * `children`. Inset 24px, 20px top and bottom, 16px between parts.
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
  /** Sets the title's id, for a card labelled by it. */
  titleId?: string;
  action?: ReactNode;
  /** A line between the header and the rule. */
  note?: ReactNode;
}) {
  const heading = (
    <h2 id={titleId} className={SECTION_HEADING}>
      {title}
    </h2>
  );
  return (
    <Card className={cn(DETAIL_CARD, className)} {...props}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        {action ? (
          // Wraps so a wide action drops under the title instead of widening
          // the card.
          <div className="flex flex-wrap items-center justify-between gap-4">
            {heading}
            {action}
          </div>
        ) : (
          heading
        )}
        {note}
        <Separator />
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * A card row with a label rail: the label, and a badge beside it, on a 192px
 * column, then the value 24px after it, stacked under `sm`. The rail is 216px
 * less the gap, so the value starts on the column an inline field's input
 * does. `divider` closes the row with the rule the next one sits under.
 */
export function DetailRow({
  label,
  align = "start",
  divider = false,
  as: Tag = "div",
  children,
}: {
  label: ReactNode;
  /** `center` for a one-line value, as a row with a trailing menu. */
  align?: "start" | "center";
  divider?: boolean;
  as?: "div" | "li";
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "flex flex-col gap-1 sm:flex-row sm:gap-6",
        align === "center" ? "sm:items-center" : "sm:items-start",
        divider && "border-b border-border py-3",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 text-sm leading-5 text-muted-foreground sm:w-48">
        {label}
      </div>
      {children}
    </Tag>
  );
}

/** The single panel card of a configuration detail screen (inside `<Page inset="panel">`). */
export function DetailPanel({ children }: { children: ReactNode }) {
  return <Card className="gap-4 border-foreground/10 px-6 py-5 shadow-xs">{children}</Card>;
}

/**
 * A panel's title lockup: the icon tile, an optional eyebrow, and the heading —
 * the `h1` of a configuration screen, or an `h2` on a body card under a
 * {@link DetailHeader}, which already owns the `h1`.
 */
export function PanelTitle({
  icon: Icon,
  eyebrow,
  title,
  as: Heading = "h1",
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  as?: "h1" | "h2";
}) {
  const heading = (
    <Heading className="truncate font-serif text-lg leading-6 text-foreground">{title}</Heading>
  );
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
 * A detail screen's header as the design draws the user-schema screen: the
 * title over one line of identity, the resource's id (copyable) and its created
 * date, with no icon tile and no meta card. The line stacks under `sm`, where
 * the id alone fills it, and the rule between the two values exists only in the
 * row layout.
 */
export function DetailTitle({
  title,
  idLabel,
  id,
  createdAt,
}: {
  title: string;
  /** The id's label, e.g. `Schema ID`; the copy button's name follows it. */
  idLabel: string;
  id: string;
  createdAt?: string;
}) {
  return (
    <header className="flex flex-col gap-2 px-2">
      <h1 className={cn(DETAIL_TITLE, "wrap-anywhere")}>{title}</h1>
      <div className="text-muted-foreground flex flex-col gap-1 text-xs leading-4 sm:flex-row sm:items-center">
        <span className="flex flex-wrap items-center gap-x-1">
          <span className="whitespace-nowrap">{idLabel}</span>
          <span className="flex min-w-0 items-center gap-1">
            {/* `break-all`: a URI id has no break point and must not widen the page. */}
            <span className="text-foreground min-w-0 break-all">{id}</span>
            <CopyButton value={id} label={`Copy ${idLabel}`} size="inline" />
          </span>
        </span>
        {createdAt && (
          <>
            <span aria-hidden className="bg-border mx-4.5 hidden h-4 w-px shrink-0 sm:block" />
            <span className="flex items-center gap-1">
              <span>Created</span>
              <span>{formatDate(createdAt)}</span>
            </span>
          </>
        )}
      </div>
    </header>
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
    // Top-aligned, not centred against the meta card: the 36px icon tile is the
    // title row (`PAGE_TITLE_ROW`), so the title lands on the same line as
    // every list's and settings screen's.
    <div className="flex flex-col gap-4 px-2 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
      <div className="flex min-h-9 min-w-0 items-center gap-3">
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
