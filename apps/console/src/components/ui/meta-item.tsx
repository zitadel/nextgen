import { cn } from "@/lib/utils";

/**
 * `MetaItem` — the small annotation that sits beside a label, e.g. `Optional`.
 *
 * The design system instances it as `Optional` in the `Field` label row. It is
 * never part of `Field` itself: a call site renders it only where it asks for
 * it, as a sibling of the label so the field's accessible name stays the label.
 *
 * Arimo Regular 12/16, normal tracking, `muted-foreground`, sentence case.
 */
export function MetaItem({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="meta-item"
      className={cn(
        "shrink-0 font-sans text-xs leading-4 font-normal tracking-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
