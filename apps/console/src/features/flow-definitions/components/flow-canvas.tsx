import { Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  CANVAS_CARD_WIDTH,
  type CanvasCard,
  type CanvasEdgeKind,
  type FlowCanvasLayout,
  type SketchRow,
  layoutFlowCanvas,
} from "../canvas";
import type { FlowDefinition } from "../model";

const EDGE_KINDS: CanvasEdgeKind[] = ["action", "outcome", "purpose", "entry"];

const EDGE_TONE: Record<CanvasEdgeKind, string> = {
  action: "text-foreground",
  outcome: "text-warning",
  purpose: "text-primary",
  entry: "text-primary",
};

const LEGEND: { kind: CanvasEdgeKind; text: string }[] = [
  { kind: "action", text: "Fired by an action" },
  { kind: "outcome", text: "Fired by an outcome" },
  { kind: "purpose", text: "To a purpose" },
];

/**
 * The definition drawn read-only: a card per step sketching its screen, an
 * arrow per transition. Full screen lifts the viewport over the app shell.
 */
export function FlowCanvas({ definition, name }: { definition: FlowDefinition; name: string }) {
  const canvas = useMemo(() => layoutFlowCanvas(definition), [definition]);
  const [full, setFull] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      toggle.current?.focus();
    };
  }, [full]);

  return (
    <DetailSection
      title="Canvas"
      action={
        <Button
          ref={toggle}
          variant="secondary"
          size="sm"
          className={CARD_ACTION_BUTTON}
          onClick={() => setFull(true)}
        >
          <Maximize2 aria-hidden />
          Full screen
        </Button>
      }
    >
      {full ? (
        createPortal(
          <div
            role="dialog"
            aria-label={`${name} canvas`}
            className="fixed inset-0 z-50 flex flex-col bg-background"
          >
            <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
              <h2 className={cn(SECTION_HEADING, "mr-auto")}>{name}</h2>
              <Legend />
              <Button
                autoFocus
                variant="secondary"
                size="sm"
                className={CARD_ACTION_BUTTON}
                onClick={() => setFull(false)}
              >
                <Minimize2 aria-hidden />
                Exit full screen
              </Button>
            </div>
            <Viewport canvas={canvas} className="min-h-0 flex-1" />
          </div>,
          document.body,
        )
      ) : (
        <>
          <Viewport canvas={canvas} className="h-105 rounded-md border" />
          <Legend />
        </>
      )}
    </DetailSection>
  );
}

/** Scrolls both ways when the flow outgrows it; focusable so the keyboard can scroll it too. */
function Viewport({ canvas, className }: { canvas: FlowCanvasLayout; className: string }) {
  return (
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus to scroll
      tabIndex={0}
      aria-label="Flow canvas"
      className={cn("overflow-auto bg-background outline-none focus-visible:ring-2", className)}
    >
      <div className="relative" style={{ width: canvas.width, height: canvas.height }}>
        <svg
          aria-hidden
          className="absolute inset-0"
          width={canvas.width}
          height={canvas.height}
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        >
          <defs>
            {EDGE_KINDS.map((kind) => (
              <marker
                key={kind}
                id={`flow-arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M0,1 L10,5 L0,9 Z" className={cn("fill-current", EDGE_TONE[kind])} />
              </marker>
            ))}
          </defs>
          {canvas.edges.map((edge) => (
            <g key={edge.id} className={EDGE_TONE[edge.kind]}>
              <path
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={edge.kind === "purpose" ? "5 4" : undefined}
                markerEnd={`url(#flow-arrow-${edge.kind})`}
              />
              {edge.label && edge.labelAt && (
                <text
                  x={edge.labelAt.x}
                  y={edge.labelAt.y - 6}
                  textAnchor="middle"
                  className="fill-current stroke-background font-mono text-[11px] [paint-order:stroke]"
                  strokeWidth={5}
                  strokeLinejoin="round"
                >
                  {edge.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {canvas.pills.map((pill) => (
          <div
            key={pill.purpose}
            className="absolute flex items-center justify-center rounded-full border border-primary bg-background font-mono text-[11px] text-primary"
            style={{ left: pill.x, top: pill.y, width: pill.width, height: pill.height }}
          >
            <span className="absolute -top-4 left-0 font-sans text-[9px] tracking-widest text-muted-foreground uppercase">
              Purpose
            </span>
            {pill.purpose}
          </div>
        ))}
        {canvas.cards.map((card) => (
          <StepCard key={card.name} card={card} />
        ))}
      </div>
    </section>
  );
}

/** The step's screen as a sketch: its parts at the offsets the layout routed arrows to. */
function StepCard({ card }: { card: CanvasCard }) {
  const { sketch } = card;
  return (
    <div
      className="absolute overflow-hidden rounded-md border bg-card text-card-foreground"
      style={{ left: card.x, top: card.y, width: CANVAS_CARD_WIDTH, height: sketch.height }}
    >
      <div className="flex h-8 items-center border-b bg-muted px-3 font-mono text-xs text-muted-foreground">
        <span className="truncate">{card.name}</span>
      </div>
      {sketch.rows.map((row) => (
        <div
          key={`${row.kind}:${row.label}`}
          className="absolute inset-x-3"
          style={{ top: row.top, height: row.height }}
        >
          <SketchControl row={row} />
        </div>
      ))}
      {sketch.footer && (
        <div className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-2 border-t bg-muted px-3 text-[11px] text-muted-foreground">
          {sketch.footer.label}
          <span className="font-mono text-foreground">{sketch.footer.value}</span>
        </div>
      )}
    </div>
  );
}

const CONTROL = "flex h-8 items-center justify-center truncate rounded-md px-2 text-xs font-medium";

function SketchControl({ row }: { row: SketchRow }): ReactNode {
  switch (row.kind) {
    case "field":
      return (
        <>
          <div className="truncate text-[11px] leading-4 font-medium">{row.label}</div>
          <div className="mt-1 h-8 rounded-md border bg-background" />
        </>
      );
    case "button":
      return (
        <div
          className={cn(
            CONTROL,
            row.primary ? "bg-primary text-primary-foreground" : "border bg-background",
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
        <div className="flex h-full items-center gap-2 text-[11px] text-muted-foreground">
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

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
      {LEGEND.map(({ kind, text }) => (
        <span key={kind} className="inline-flex items-center gap-2">
          <svg aria-hidden width="28" height="8" className={EDGE_TONE[kind]}>
            <line
              x1="0"
              y1="4"
              x2="28"
              y2="4"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray={kind === "purpose" ? "5 4" : undefined}
            />
          </svg>
          {text}
        </span>
      ))}
    </div>
  );
}
