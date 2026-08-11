import { cn } from "@/lib/utils"

/**
 * `Typography / InlineCode` (`1389:9783`) — shadcn's inline-code treatment.
 *
 * A `muted` fill with mono 12/16 on `foreground`, at the design's own 4.8/3.2px
 * inset. Used for the schema attribute chips and for the `zitadel apply` hint
 * under the document viewer, which is why it lives here rather than in either
 * one.
 *
 * https://ui.shadcn.com/docs/components/typography#inline-code
 */
export function InlineCode({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="inline-code"
      className={cn(
        "inline-flex items-center justify-center rounded-sm bg-muted px-[0.3rem] py-[0.2rem] font-mono text-xs leading-4 text-foreground",
        className,
      )}
      {...props}
    />
  )
}
