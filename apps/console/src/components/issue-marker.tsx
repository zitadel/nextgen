import { TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The glyph's colour: a failure, or a setting below a recommendation. */
type Tone = "destructive" | "warning";

const TONE: Record<Tone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
};

/**
 * A warning glyph at the end of a value, opening the note behind it. A row
 * has room for the glyph alone, so the detail lives in a popover rather than
 * a title attribute a keyboard or a touch device never sees. `children` are
 * the note's `PopoverHeader`s. The note opens off the glyph, or off `anchor`
 * where the glyph sits inside something the note must not cover.
 */
export function IssueMarker({
  tone,
  label,
  side,
  sideOffset,
  align = "center",
  anchor,
  contentClassName,
  children,
}: {
  tone: Tone;
  /** The glyph's accessible name. */
  label: string;
  side?: ComponentProps<typeof PopoverContent>["side"];
  sideOffset?: ComponentProps<typeof PopoverContent>["sideOffset"];
  anchor?: RefObject<HTMLElement | null>;
  align?: ComponentProps<typeof PopoverContent>["align"];
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      {anchor && <PopoverAnchor virtualRef={anchor} />}
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "shrink-0 cursor-pointer rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          TONE[tone],
        )}
      >
        <TriangleAlert className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align={align}
        className={cn("flex w-auto flex-col gap-2.5 border-foreground/10 p-2", contentClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
