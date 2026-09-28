import { CopyButton } from "@/components/ui/copy-button";

/**
 * The header card that identifies a resource on its detail screen — the strip of
 * labelled values (id, created, …) beside the title, shared by the user and team
 * detail screens.
 *
 * Named `MetaValue` rather than `MetaItem` because `@/components/ui/meta-item`
 * already owns that name for the small uppercase annotation beside a field
 * label. This is the label-plus-value pair; that is the eyebrow alone.
 */
export const EYEBROW =
  "text-muted-foreground font-serif text-xs leading-4 tracking-[0.72px] uppercase";

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
    // The value sets the width, at every size. The frames draw an 8-character id
    // where real ids are ~30-character ULIDs, so the card is wider here than as
    // drawn — but an id you cannot read in full is worse than a wide card.
    //
    // `shrink-0` on both the value and its column is what enforces that: without
    // it flex shaves the box to a pixel or two under the text, which clips the
    // final glyph — and because the shortfall is smaller than an ellipsis, no
    // ellipsis appears either. The result reads as a typo in the id rather than
    // as truncation.
    <div className="flex shrink-0 flex-col gap-[3px]">
      <span className={EYEBROW}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-foreground shrink-0 font-mono text-[13px] leading-[19px] tracking-[-0.5px] whitespace-nowrap">
          {value}
        </span>
        {/* Sized under the 19px value line so the copy affordance never drives
            the row height — the card is 61px tall in the design, and a 24px
            button pushes it to 69. */}
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
 * on both sides. Same mark, two layouts, exactly as the frames draw it.
 */
export function MetaRule() {
  return (
    <span
      aria-hidden
      className="bg-border ml-[18px] h-[30px] w-px shrink-0 sm:mx-[18px] sm:self-center"
    />
  );
}
