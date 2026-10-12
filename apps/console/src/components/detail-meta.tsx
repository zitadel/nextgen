import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

import { EYEBROW } from "./typography";

/**
 * The card of labelled values (`MetaValue`, split by `MetaRule`) that identifies
 * a resource: stacked below `sm`, where the rule becomes a tick on its own row,
 * and in a row above it.
 *
 * `max-w-full` + `overflow-x-auto`: its width is set by the id, which is never
 * truncated, so a narrow screen scrolls the card rather than the page.
 *
 * `MetaValue`, not `MetaItem`: `@/components/ui/meta-item` owns that name for
 * the small uppercase annotation beside a field label.
 */
export function MetaCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("max-w-full gap-0 overflow-x-auto py-0", className)}>
      <CardContent className="flex flex-col px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-center">
        {children}
      </CardContent>
    </Card>
  );
}

/** One labelled value in a detail header card, optionally copyable. */
export function MetaValue({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    // The value sets the width, at every size. The design draws an 8-character id
    // where real ids are ~30-character ULIDs, so the card is wider here than as
    // drawn — but an id you cannot read in full is worse than a wide card.
    //
    // `shrink-0` on both the value and its column is what enforces that: without
    // it flex shaves the box to a pixel or two under the text, which clips the
    // final glyph — and because the shortfall is smaller than an ellipsis, no
    // ellipsis appears either. The result reads as a typo in the id rather than
    // as truncation.
    <div className="flex shrink-0 flex-col gap-0.75">
      <span className={EYEBROW}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-foreground shrink-0 font-mono text-[13px] leading-[19px] tracking-[-0.5px] whitespace-nowrap">
          {value}
        </span>
        {/* Sized under the 19px value line so the copy affordance never drives
            the row height — the card is 66px tall in the design, and a 24px
            button pushes it to 71. */}
        {copyable && (
          <CopyButton
            value={value}
            label={`Copy ${label}`}
            size="icon-xs"
            className="size-4 shrink-0"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The rule between two values in a header card — a 30px hairline rather than a
 * plain gap.
 *
 * Stacked, it is a tick inset 18px on its own row; in a row it takes 18px of air
 * on both sides. Same mark, two layouts, as the design draws it.
 */
export function MetaRule() {
  return (
    <span aria-hidden className="bg-border ml-4.5 h-7.5 w-px shrink-0 sm:mx-4.5 sm:self-center" />
  );
}
