import type { CSSProperties, ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

import { CANVAS_CARD_WIDTH, type CanvasCard, type SketchRow } from "../canvas";

/**
 * A step's screen as a static sketch in the project's branding: `style`
 * carries its `--zl-*` values, which the theme utilities below read. Each
 * control that fires an action is marked `data-port` so the canvas can measure
 * where its arrow leaves from.
 */
export function StepCard({
  card,
  logo,
  style,
  dimmed,
  ref,
  onHighlight,
}: {
  card: CanvasCard;
  logo?: string;
  style: CSSProperties;
  dimmed: boolean;
  ref: Ref<HTMLElement>;
  onHighlight: (step: string | null) => void;
}) {
  const { sketch } = card;
  return (
    <article
      ref={ref}
      aria-label={`Step ${card.name}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusing a step isolates its transitions
      tabIndex={0}
      onPointerEnter={() => onHighlight(card.name)}
      onPointerLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(card.name)}
      onBlur={() => onHighlight(null)}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-md border bg-card font-sans text-card-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        dimmed && "opacity-15",
      )}
      style={{ ...style, left: card.x, top: card.y, width: CANVAS_CARD_WIDTH }}
    >
      <div className="flex h-8 shrink-0 items-center border-b bg-muted px-3 font-mono text-xs text-muted-foreground">
        <span className="truncate">{card.name}</span>
      </div>
      {(logo || sketch.rows.length > 0) && (
        <div className="flex flex-col gap-2 p-3">
          {logo && <img src={logo} alt="" className="mx-auto mb-1 h-6 max-w-full object-contain" />}
          {sketch.rows.map((row) => (
            <div key={`${row.kind}:${row.label}`} data-port={row.action}>
              <SketchControl row={row} />
            </div>
          ))}
        </div>
      )}
      {sketch.footer && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-muted px-3 text-[11px] text-muted-foreground">
          {sketch.footer.label}
          <span className="font-mono text-foreground">{sketch.footer.value}</span>
        </div>
      )}
    </article>
  );
}

const CONTROL = "flex h-8 items-center justify-center truncate rounded-md px-2 text-xs font-medium";

function SketchControl({ row }: { row: SketchRow }): ReactNode {
  switch (row.kind) {
    case "field":
      return (
        <>
          <div className="truncate text-[11px] leading-4 font-medium">{row.label}</div>
          <div className="mt-1 h-8 rounded-md border border-input bg-background" />
        </>
      );
    case "button":
      return (
        <div
          className={cn(
            CONTROL,
            row.primary
              ? "bg-primary text-primary-foreground"
              : "border bg-secondary text-secondary-foreground",
          )}
        >
          {row.label}
        </div>
      );
    case "provider":
      return (
        <div
          className={cn(
            CONTROL,
            "border border-provider-border bg-provider text-provider-foreground",
          )}
        >
          {row.label}
        </div>
      );
    case "divider":
      return (
        <div className="flex h-4 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {row.label}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "link":
      return (
        <div className="truncate text-center text-xs leading-5 text-link underline underline-offset-2">
          {row.label}
        </div>
      );
  }
}
