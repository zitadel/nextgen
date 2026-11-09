import type { LucideIcon } from "lucide-react";
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  type ReactNode,
  useContext,
} from "react";

import { Card, CardContent } from "@/components/ui/card";
import { IdText } from "@/components/id-text";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

import { MetaCard } from "./detail-meta";
import { SECTION_HEADING, PAGE_TITLE } from "./typography";

/**
 * Shared geometry for the console's detail screens, the detail counterpart of
 * `resource-list.tsx`. Resources (Users, Teams, Project settings) and
 * configuration (Login flows, Identity providers, Releases) draw the same
 * shell: a header, then body cards of labelled rows.
 *
 * Its measurements live in "Resource detail layout" in `docs/styling.md`,
 * which a change to a value here updates too.
 *
 * The user-schema screen heads the same body with {@link DetailTitle}: the
 * title over one line of identity, with no icon tile or meta card.
 */

/** The 24px gap between the header row and the first body element. */
export const DETAIL_BODY = "mt-6";

/**
 * The 16px between a detail body's parts: the tab row and the first card, and
 * card and card.
 */
export const DETAIL_STACK = "flex flex-col gap-4";

/** A detail screen's title: the 24/24 display face. */
export const DETAIL_TITLE = PAGE_TITLE;

/** The icon tile a detail title leads with. */
export const ICON_PLATE =
  "bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md";

/** A card's or tab row's small action: 12px text, a 14px glyph. */
export const CARD_ACTION_BUTTON = "gap-1 px-2.5 text-xs [&_svg]:size-3.5!";

/** A row's read-only value: 14/20, wrapping anywhere rather than widening the card. */
export const DETAIL_VALUE = "min-w-0 text-sm leading-5 text-foreground wrap-anywhere";

/** A row's placeholder value (`—`, `Not used`): the value line, muted. */
export const DETAIL_VALUE_EMPTY = "text-sm leading-5 text-muted-foreground";

/** A body card: the stock `Card` with its own gap and padding removed. */
export const DETAIL_CARD = "gap-0 py-0";

/**
 * The label column of a card row from `sm`: 218px from the card's content
 * edge to the value, on every detail card.
 */
export const DETAIL_LABEL_RAIL = "sm:w-54.5";

/**
 * The same column for a label beside a form control: the rail less the 12px
 * gap a horizontal `Field` puts between label and control, so an input starts
 * where a read-only value does.
 */
export const FIELD_LABEL_RAIL = "sm:w-51.5";

/**
 * {@link FIELD_LABEL_RAIL} for a responsive `Field` inside a `FieldGroup`,
 * which lays out on the group's width rather than the viewport. The `!` beats
 * the responsive Field's own `flex-auto` on its label.
 */
export const FIELD_GROUP_LABEL_RAIL = "@md/field-group:flex-[0_0_206px]!";

/**
 * A body card with a titled section: the title (an `h2` in `SECTION_HEADING`),
 * then `aside` beside it (a value the title names, such as a login flow's
 * schema) and `action` at the row's end, a rule, then `children`. Inset 24px,
 * 20px top and bottom, 16px between parts. `asideOnRail` starts the aside on
 * the label rail, level with the controls of a form below it, as the user
 * detail's schema card draws it: like that form's fields, the title row lays
 * out on the card's width (`@md/field-group`), not the viewport's. Otherwise
 * the aside follows the title 16px after.
 */
export function DetailSection({
  title,
  titleId,
  aside,
  asideOnRail = false,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Card>, "title"> & {
  title: string;
  /** Sets the title's id, for a card labelled by it. */
  titleId?: string;
  aside?: ReactNode;
  asideOnRail?: boolean;
  action?: ReactNode;
}) {
  const heading = (
    <h2 id={titleId} className={SECTION_HEADING}>
      {title}
    </h2>
  );
  const lead = !aside ? (
    heading
  ) : asideOnRail ? (
    <div className="flex min-w-0 flex-col gap-2 @md/field-group:flex-row @md/field-group:items-center @md/field-group:gap-0">
      <div className="shrink-0 @md/field-group:w-54.5">{heading}</div>
      {aside}
    </div>
  ) : (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {heading}
      {aside}
    </div>
  );
  return (
    <Card className={cn(DETAIL_CARD, className)} {...props}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        {/* The container a railed aside lays out on: the full row's width,
            the same as a form's `FieldGroup` below it. */}
        <div className={asideOnRail ? "@container/field-group" : "contents"}>
          {action ? (
            // Wraps so a wide action drops under the title instead of widening
            // the card.
            <div className="flex flex-wrap items-center justify-between gap-4">
              {lead}
              {action}
            </div>
          ) : (
            lead
          )}
        </div>
        <Separator />
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Whether the rows of the nearest {@link DetailRows} lay out on that list's
 * own width rather than the viewport's.
 */
const RowsOnContainer = createContext(false);

/** Row layout on the viewport: the rail from `sm`. */
const ROW_VIEWPORT = {
  row: "flex flex-col gap-1 sm:flex-row sm:gap-0",
  center: "sm:items-center",
  start: "sm:items-start",
  rail: DETAIL_LABEL_RAIL,
  control: "sm:min-h-6",
};

/**
 * Row layout on the list's width (`@md/detail-rows`, 448px): for rows nested
 * in a narrower column, where the viewport says nothing about the room left.
 */
const ROW_CONTAINER = {
  row: "flex flex-col gap-1 @md/detail-rows:flex-row @md/detail-rows:gap-0",
  center: "@md/detail-rows:items-center",
  start: "@md/detail-rows:items-start",
  rail: "@md/detail-rows:w-54.5",
  control: "@md/detail-rows:min-h-6",
};

/**
 * A card row: the label (and a badge beside it) in the {@link DETAIL_LABEL_RAIL}
 * column, the value from its end, stacked under `sm` (or, inside
 * `<DetailRows container>`, below 448px of the list's own width). A 20px line
 * with 4px above and below. `divider` gives it 12px above and below and closes it with
 * its own rule, for rows that carry a menu (Origins); otherwise rows sit in
 * {@link DetailRows}.
 */
export function DetailRow({
  label,
  align = "start",
  divider = false,
  as: Tag = "div",
  children,
}: {
  label: ReactNode;
  /**
   * `center` for a one-line value, as a row with a trailing menu. `control`
   * for a value whose first line is a 24px control (an accordion trigger, an
   * origin link): the label centres on that line instead of sitting 2px above
   * its text.
   */
  align?: "start" | "center" | "control";
  divider?: boolean;
  as?: "div" | "li";
  children: ReactNode;
}) {
  const layout = useContext(RowsOnContainer) ? ROW_CONTAINER : ROW_VIEWPORT;
  return (
    <Tag
      className={cn(
        layout.row,
        align === "center" ? layout.center : layout.start,
        divider ? "border-b border-border py-3" : "py-1",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 text-sm leading-5 font-medium text-muted-foreground",
          layout.rail,
          align === "control" && layout.control,
        )}
      >
        {label}
      </div>
      {children}
    </Tag>
  );
}

/**
 * The rule between rows takes no height: the design draws it as a zero-height
 * line, so the 16px either side is all the space between two rows. The
 * negative margin takes back `Separator`'s 1px from the gap above, where the
 * design's line renders: on the last pixel of that gap.
 */
const ROW_RULE = "-mt-px";

/**
 * A card's list of rows ({@link DetailRow}, or a row of its own shape): 16px,
 * a rule, 16px between each, and no rule after the last. `as="ul"` makes it a
 * list: each row is wrapped in its `li`, and the rules are presentational.
 * `container` lays its rows out on the list's own width, for rows nested
 * inside another row's value (a policy's settings in a release).
 */
export function DetailRows({
  as = "div",
  container = false,
  children,
}: {
  as?: "div" | "ul";
  container?: boolean;
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  const rule = (key: number) =>
    as === "ul" ? (
      <li key={`rule-${key}`} role="none">
        <Separator className={ROW_RULE} />
      </li>
    ) : (
      <Separator key={`rule-${key}`} className={ROW_RULE} />
    );
  const Tag = as;
  return (
    <RowsOnContainer.Provider value={container}>
      <Tag className={cn("flex flex-col gap-4", container && "@container/detail-rows")}>
        {rows.map((row, index) => (
          // `Children.toArray` has keyed every element row.
          <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
            {index > 0 && rule(index)}
            {as === "ul" ? <li>{row}</li> : row}
          </Fragment>
        ))}
      </Tag>
    </RowsOnContainer.Provider>
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
        <span className="flex min-w-0 flex-wrap items-center gap-x-1">
          <span className="whitespace-nowrap">{idLabel}</span>
          <span className="flex min-w-0 items-center gap-1">
            {/* One line, cut in the middle: a URI id must not widen the page. */}
            <IdText id={id} title={id} className="text-foreground" />
            <CopyButton value={id} label={`Copy ${idLabel}`} size="inline" />
          </span>
        </span>
        {createdAt && (
          <>
            <span aria-hidden className="bg-border mx-4.5 hidden h-4 w-px shrink-0 sm:block" />
            <span className="flex shrink-0 items-center gap-1">
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
 * A detail screen's header row: the title lockup on the left, the meta card
 * and an optional action (a row menu) on the right.
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
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** Beside the title, e.g. a `StatusBadge`. */
  status?: ReactNode;
  /** A second identity line under the title, e.g. a user's identifier. */
  subtitle?: string;
  /** The `MetaValue`s for the header card. */
  meta: ReactNode;
  /** After the meta card, e.g. the resource's actions menu. */
  action?: ReactNode;
}) {
  const lockup = (
    <div className="flex min-h-9 min-w-0 items-center gap-3">
      <span className={ICON_PLATE}>
        <Icon className="size-4" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* `wrap-anywhere`, not `break-words`: only `anywhere` lowers the
              flex item's minimum width, so a title with no break point (a
              user's email address) wraps on a phone instead of widening the
              page past the viewport. */}
          <h1 className={cn(DETAIL_TITLE, "wrap-anywhere")}>{title}</h1>
          {status}
        </div>
        {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      </div>
    </div>
  );

  if (action) {
    // Below `lg` the action stays on the title's row, and the meta card takes
    // the full width under both rather than sharing a row with the menu, which
    // would leave a long id too little room. From `lg` the card and the action
    // travel together and wrap under the title as the plain header's card
    // does. `contents` lets the grid place the pair's children below `lg`.
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-2 lg:flex lg:flex-wrap lg:justify-between">
        {lockup}
        <div className="contents lg:flex lg:items-start lg:gap-4">
          <MetaCard className="col-span-2 row-start-2">{meta}</MetaCard>
          <div className="col-start-2 row-start-1">{action}</div>
        </div>
      </div>
    );
  }

  return (
    // Top-aligned, not centred against the meta card: the 36px icon tile is the
    // title row (`PAGE_TITLE_ROW`), so the title lands on the same line as
    // every list's and settings screen's.
    <div className="flex flex-col gap-4 px-2 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
      {lockup}
      <MetaCard>{meta}</MetaCard>
    </div>
  );
}
