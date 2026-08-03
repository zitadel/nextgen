import { cn } from "@/lib/utils"

/**
 * `MetaItem` — the small uppercase annotation that sits beside a label.
 *
 * One component in the design system, instanced under two names: `Optional` in
 * the `Field` label row (`27843:10611`) and `MetaItem` beside a section heading
 * (`914:602746`). Both resolve to the same inner text node (`525:3872`), so this
 * is deliberately a single implementation rather than a copy per call site.
 *
 * Arimo Medium 10/15, `0.4px` tracking, `muted-foreground`. Uppercased in CSS
 * rather than in the string so the accessible name and any copied text stay
 * sentence case — the design's text node reads `OPTIONAL`, which renders
 * identically.
 */
export function MetaItem({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="meta-item"
      className={cn(
        "shrink-0 text-[10px] leading-[15px] font-medium tracking-[0.4px] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  )
}
