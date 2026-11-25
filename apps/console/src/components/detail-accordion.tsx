import type { ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * The accordion a detail card's row opens its values in: one row per item,
 * each opening to its own content, as a release's pinned revisions and an
 * application's clients. It is a `DetailRow`'s value (`align="control"`), so
 * the first row's title sits level with the row's label.
 *
 * Its measurements live in "Resource detail layout" in `docs/styling.md`,
 * which a change to a value here updates too.
 */
export function DetailAccordion({
  defaultValue,
  children,
}: {
  /** The items open at first; none unless given. */
  defaultValue?: string[];
  children: ReactNode;
}) {
  return (
    <Accordion type="multiple" defaultValue={defaultValue} className="min-w-0 flex-1">
      {children}
    </Accordion>
  );
}

/**
 * One row of a {@link DetailAccordion}: the title, a chevron at the row's end,
 * and the content it opens to, 16px under the title and 16px between its
 * parts.
 *
 * `title` is the trigger's content and so its accessible name; a title of
 * several parts puts a literal space between them, which a flex row drops
 * visually and a screen reader needs.
 */
export function DetailAccordionItem({
  value,
  title,
  children,
}: {
  value: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    // 12px above and below the rule between rows: a 48px row pitch.
    <AccordionItem value={value} className="py-3 first:pt-0 last:pb-0">
      {/* 24px: a 20px line with 2px above and below, so the row's text sits
          level with the label beside the accordion. The shared trigger
          underlines on hover and tops its chevron on the first line of a
          wrapped label; this row is one line, centred. `min-w-0` lets the row
          shrink below its title, so a long title truncates or wraps on a
          phone instead of pushing the chevron off the card. */}
      <AccordionTrigger
        level={4}
        className="min-w-0 items-center py-0.5 hover:no-underline [&>svg]:translate-y-0"
      >
        {/* The shared trigger is medium; the frames set the title regular. */}
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm leading-5 font-normal text-foreground">
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-4 pt-4 pb-4">{children}</AccordionContent>
    </AccordionItem>
  );
}
