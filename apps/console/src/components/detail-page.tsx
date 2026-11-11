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
import { cn } from "@/lib/utils";

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
 * Every one is headed by {@link DetailHeader}: the title, then one line of
 * identity values.
 */

/** The 36px gap between the header's identity line and the first body element. */
export const DETAIL_BODY = "mt-9";

/**
 * The 16px between a detail body's parts: the tab row and the first card, and
 * card and card.
 */
export const DETAIL_STACK = "flex flex-col gap-4";

/** A detail screen's title: the 24/24 display face. */
export const DETAIL_TITLE = PAGE_TITLE;

/** The icon tile a detail title leads with: 24px, the title's line, a 16px glyph. */
const ICON_PLATE =
  "bg-muted text-foreground flex size-6 shrink-0 items-center justify-center rounded-sm";

/**
 * The rule before an identity value that follows another: 1px by 16px, 8px
 * either side, from `sm`. A pseudo-element, so the `<dl>` holds only its
 * groups.
 */
const META_RULE =
  "sm:before:bg-border sm:before:mx-2 sm:before:h-4 sm:before:w-px sm:before:shrink-0 sm:before:content-['']";

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
 *
 * Tailwind reads class names whole, so the rail is spelled out wherever a
 * variant needs it: here, the section aside's `@md/field-group:w-54.5`, and
 * the container rows' `@md/detail-rows:w-54.5`. The two field rails below
 * are this one less a field's gap. A change to one is a change to all five.
 */
const DETAIL_LABEL_RAIL = "sm:w-54.5";

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
 * then `aside` on the label rail (a value the title names, such as a login
 * flow's or a user's schema) and `action` at the row's end, a rule, then
 * `children`. Inset 24px, 20px top and bottom, 16px between parts. Like a
 * form's fields, the title row lays out on the card's width
 * (`@md/field-group`), not the viewport's, so the aside starts level with the
 * values and controls below it.
 */
export function DetailSection({
  title,
  titleId,
  aside,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Card>, "title"> & {
  title: string;
  /** Sets the title's id, for a card labelled by it. */
  titleId?: string;
  aside?: ReactNode;
  action?: ReactNode;
}) {
  const heading = (
    <h2 id={titleId} className={SECTION_HEADING}>
      {title}
    </h2>
  );
  const lead = aside ? (
    <div className="flex min-w-0 flex-col gap-2 @md/field-group:flex-row @md/field-group:items-center @md/field-group:gap-0">
      <div className="shrink-0 @md/field-group:w-54.5">{heading}</div>
      {aside}
    </div>
  ) : (
    heading
  );
  return (
    <Card className={cn(DETAIL_CARD, className)} {...props}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        {/* The container the aside lays out on: the full row's width, the
            same as a form's `FieldGroup` below it. */}
        <div className={aside ? "@container/field-group" : "contents"}>
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
 * A card row: the label (and a badge beside it) in the label rail, the value
 * from its end, stacked under `sm` (or, inside `<DetailRows container>`, below
 * 448px of the list's own width). A 20px line with 4px above and below; rows
 * sit in {@link DetailRows}, which rules between them.
 */
export function DetailRow({
  label,
  align = "start",
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
  children: ReactNode;
}) {
  const layout = useContext(RowsOnContainer) ? ROW_CONTAINER : ROW_VIEWPORT;
  return (
    <div className={cn(layout.row, align === "center" ? layout.center : layout.start, "py-1")}>
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
    </div>
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

/** One value on a detail header's identity line. */
export interface DetailMetaItem {
  /** Unique on the line: it names the value and keys it. */
  label: string;
  /** Left out of the line when there is none, as a user's unread created date. */
  value?: string;
  /**
   * Shown in the foreground with a copy button, and cut in the middle rather
   * than widening the page: an id, or anything else a person copies.
   */
  copyable?: boolean;
}

/**
 * A detail screen's header: the title row (the icon tile, the title,
 * a status beside it, an action at the row's end), then one 12/16 identity
 * line, each value after its muted label and ruled off from the next. The
 * line stacks under `sm`, where the rules go.
 */
export function DetailHeader({
  icon: Icon,
  title,
  status,
  subtitle,
  meta,
  action,
}: {
  /** The glyph of the screen's sidebar entry. */
  icon: LucideIcon;
  title: string;
  /** Beside the title, e.g. a `StatusBadge`. */
  status?: ReactNode;
  /** A second identity line under the title, e.g. a user's identifier. */
  subtitle?: string;
  meta: DetailMetaItem[];
  /** At the title row's end, e.g. the resource's actions menu. */
  action?: ReactNode;
}) {
  const items = meta.filter((item): item is DetailMetaItem & { value: string } =>
    Boolean(item.value),
  );
  return (
    <header className="flex items-start justify-between gap-4 px-2">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 items-start gap-2">
          <span className={ICON_PLATE}>
            <Icon className="size-4" strokeWidth={1.5} aria-hidden />
          </span>
          {/* The subtitle shares the title's left edge, not the tile's. */}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {/* `wrap-anywhere`, not `break-words`: only `anywhere` lowers the
                  flex item's minimum width, so a title with no break point (a
                  user's email address) wraps on a phone instead of widening
                  the page past the viewport. */}
              <h1 className={cn(DETAIL_TITLE, "wrap-anywhere")}>{title}</h1>
              {status}
            </div>
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
          </div>
        </div>
        {items.length > 0 && (
          // One line from `sm`, never wrapped: a long id is cut in the middle
          // to make room rather than pushing the next value onto a line that
          // would start with a rule.
          <dl className="text-muted-foreground flex flex-col gap-1 text-xs leading-4 sm:flex-row sm:items-center sm:gap-0">
            {items.map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-center",
                  item.copyable ? "min-w-0" : "shrink-0",
                  index > 0 && META_RULE,
                )}
              >
                <dt className="shrink-0 whitespace-nowrap">{item.label}</dt>
                {/* `gap-0.5`: the copy glyph sits 2px inside its 16px button, so
                  it lands 4px after the id. */}
                <dd className="ml-1 flex min-w-0 items-center gap-0.5">
                  {item.copyable ? (
                    <>
                      {/* One line, cut in the middle: a URI id must not widen the page. */}
                      <IdText id={item.value} title={item.value} className="text-foreground" />
                      <CopyButton value={item.value} label={`Copy ${item.label}`} size="inline" />
                    </>
                  ) : (
                    <span className="whitespace-nowrap">{item.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {/* Beside the title and the identity line together, so it never pushes
          the line down. */}
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
