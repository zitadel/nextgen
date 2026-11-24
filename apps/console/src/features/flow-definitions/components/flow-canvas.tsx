import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { brandingDeclarations, resolveLogoUrl } from "@zitadel/components";

import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { BrandingRevision } from "@/features/branding/branding-palette";
import { useDocumentTheme } from "@/hooks/use-document-theme";
import { useDragToPan } from "@/hooks/use-drag-to-pan";
import { useWheel } from "@/hooks/use-wheel";
import { cn } from "@/lib/utils";

import {
  type CanvasEdgeKind,
  type CanvasHighlight,
  type CardSize,
  type FlowCanvasLayout,
  highlightStep,
  layoutFlowCanvas,
  sameCardSizes,
} from "../canvas";
import {
  ZOOM_STEP,
  anchoredScroll,
  canPan,
  clampZoom,
  fitZoom,
  wheelZoom,
} from "../canvas-viewport";
import type { FlowDefinition } from "../model";
import { StepCard } from "./step-card";

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

const DIM = "transition-opacity motion-reduce:transition-none";

/** A zoom level, or the level that fits the canvas in whatever viewport shows it. */
type ZoomSetting = number | "fit";

/**
 * The definition drawn read-only: a card per step sketching its screen in the
 * project's branding, an arrow per transition. In the card it opens fitted
 * and stays fitted as the viewport changes, until a zoom is chosen; full
 * screen lifts it over the app shell at 100%.
 */
export function FlowCanvas({
  definition,
  name,
  branding,
}: {
  definition: FlowDefinition;
  name: string;
  branding?: BrandingRevision;
}) {
  const [sizes, setSizes] = useState<Record<string, CardSize>>({});
  const canvas = useMemo(() => layoutFlowCanvas(definition, sizes), [definition, sizes]);
  const [full, setFull] = useState(false);
  const [setting, setSetting] = useState<ZoomSetting>("fit");
  const [view, setView] = useState({ width: 0, height: 0 });
  const zoom = setting === "fit" ? fitZoom(view, canvas) : setting;
  const toggle = useRef<HTMLButtonElement>(null);
  const exit = useRef<HTMLButtonElement>(null);

  const onMeasure = useCallback((next: Record<string, CardSize>) => {
    setSizes((current) => (sameCardSizes(current, next) ? current : next));
  }, []);
  const onFull = (open: boolean) => {
    setFull(open);
    setSetting(open ? 1 : "fit");
  };

  // Ctrl or ⌘ with the wheel, and a trackpad pinch, zoom around the pointer;
  // a plain wheel scrolls, the page once the canvas has nothing left to scroll.
  const onWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const element = event.currentTarget as HTMLElement;
    event.preventDefault();
    const to = wheelZoom(zoom, event);
    if (to === zoom) return;
    const box = element.getBoundingClientRect();
    const scroll = anchoredScroll(
      { left: element.scrollLeft, top: element.scrollTop },
      { x: event.clientX - box.left, y: event.clientY - box.top },
      view,
      canvas,
      zoom,
      to,
    );
    // The sizer has to grow before the new offsets fit inside it.
    flushSync(() => setSetting(to));
    element.scrollLeft = scroll.left;
    element.scrollTop = scroll.top;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next =
      event.key === "+" || event.key === "="
        ? clampZoom(zoom + ZOOM_STEP)
        : event.key === "-" || event.key === "_"
          ? clampZoom(zoom - ZOOM_STEP)
          : event.key === "0"
            ? "fit"
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setSetting(next);
  };

  const zoomControls = <ZoomControls zoom={zoom} onZoom={setSetting} />;
  const stage = (
    <Viewport
      canvas={canvas}
      zoom={zoom}
      onWheel={onWheel}
      onKeyDown={full ? undefined : onKeyDown}
      onResize={setView}
      pannable={canPan(view, canvas, zoom)}
      branding={branding}
      onMeasure={onMeasure}
      className={full ? "min-h-0 flex-1" : "h-105 rounded-md border"}
    />
  );

  return (
    <DetailSection
      title="Canvas"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {zoomControls}
          <Button
            ref={toggle}
            variant="secondary"
            size="sm"
            className={CARD_ACTION_BUTTON}
            onClick={() => onFull(true)}
          >
            <Maximize2 aria-hidden />
            Full screen
          </Button>
        </div>
      }
    >
      {/* The stage moves into the dialog; an empty box of its height keeps the page from jumping. */}
      {full ? <div className="h-105" /> : stage}
      <Legend />
      <Dialog open={full} onOpenChange={onFull}>
        <DialogContent
          showCloseButton={false}
          fullScreen
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            exit.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            toggle.current?.focus();
          }}
        >
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
            <DialogTitle className={cn(SECTION_HEADING, "mr-auto")}>{name}</DialogTitle>
            <Legend />
            {zoomControls}
            <DialogClose asChild>
              <Button ref={exit} variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
                <Minimize2 aria-hidden />
                Exit full screen
              </Button>
            </DialogClose>
          </div>
          {stage}
        </DialogContent>
      </Dialog>
    </DetailSection>
  );
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (zoom: ZoomSetting) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}
      >
        <Minus aria-hidden />
      </Button>
      <output aria-label="Zoom" className="w-12 text-center text-xs tabular-nums">
        {Math.round(zoom * 100)}%
      </output>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Zoom in"
        onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}
      >
        <Plus aria-hidden />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className={CARD_ACTION_BUTTON}
        onClick={() => onZoom("fit")}
      >
        Fit
      </Button>
    </div>
  );
}

/**
 * Scrolls both ways, and pans by drag when the canvas overflows. Reports its
 * own size, so the canvas can fit it, and each card's measured size, so the
 * layout places cards by their real height.
 */
function Viewport({
  canvas,
  zoom,
  onWheel,
  onKeyDown,
  onResize,
  pannable,
  branding,
  onMeasure,
  className,
}: {
  canvas: FlowCanvasLayout;
  zoom: number;
  onWheel: (event: WheelEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onResize: (size: { width: number; height: number }) => void;
  pannable: boolean;
  branding?: BrandingRevision;
  onMeasure: (sizes: Record<string, CardSize>) => void;
  className: string;
}) {
  // Its own ref: the card's viewport and the dialog's are mounted in turn.
  const viewport = useRef<HTMLElement>(null);
  const dragging = useDragToPan(viewport);
  useWheel(viewport, onWheel);
  const side = useDocumentTheme();
  const variables = useMemo(() => brandingDeclarations(branding, side), [branding, side]);
  const logo = resolveLogoUrl(branding, side);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlight = useMemo(
    () => (highlighted ? highlightStep(canvas, highlighted) : null),
    [canvas, highlighted],
  );
  const cards = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      onResize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize]);

  // Cards are measured once laid out and again whenever one resizes (fonts and
  // the logo land after the first paint); the observer reports each on observe.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next: Record<string, CardSize> = {};
      for (const [name, element] of cards.current) {
        const ports: Record<string, number> = {};
        for (const control of element.querySelectorAll<HTMLElement>("[data-port]")) {
          const port = control.dataset.port;
          if (port) ports[port] = control.offsetTop + control.offsetHeight / 2;
        }
        next[name] = { height: element.offsetHeight, ports };
      }
      onMeasure(next);
    });
    for (const element of cards.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [canvas.cards, onMeasure]);

  return (
    <section
      ref={viewport}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus to scroll and to take zoom keys
      tabIndex={0}
      aria-label="Flow canvas"
      onKeyDown={onKeyDown}
      className={cn(
        "grid overflow-auto bg-background outline-none focus-visible:ring-2",
        pannable && (dragging ? "cursor-grabbing select-none" : "cursor-grab"),
        className,
      )}
    >
      {/* Auto margins in a grid centre what fits and start what overflows, so both ends stay reachable. */}
      <div className="m-auto" style={{ width: canvas.width * zoom, height: canvas.height * zoom }}>
        <div
          className="relative origin-top-left"
          style={{ width: canvas.width, height: canvas.height, transform: `scale(${zoom})` }}
        >
          <Edges canvas={canvas} highlight={highlight} />
          {canvas.pills.map((pill) => (
            <div
              key={pill.purpose}
              className={cn(
                "absolute flex items-center justify-center rounded-full border border-primary bg-background font-mono text-[11px] text-primary",
                DIM,
                highlight && !highlight.nodes.has(pill.id) && "opacity-15",
              )}
              style={{ left: pill.x, top: pill.y, width: pill.width, height: pill.height }}
            >
              <span className="absolute -top-4 left-0 font-sans text-[9px] tracking-widest text-muted-foreground uppercase">
                Purpose
              </span>
              {pill.purpose}
            </div>
          ))}
          {canvas.cards.map((card) => (
            <StepCard
              key={card.name}
              card={card}
              logo={logo}
              style={variables}
              dimmed={highlight !== null && !highlight.nodes.has(card.name)}
              onHighlight={setHighlighted}
              ref={(element) => {
                if (element) cards.current.set(card.name, element);
                else cards.current.delete(card.name);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Edges({
  canvas,
  highlight,
}: {
  canvas: FlowCanvasLayout;
  highlight: CanvasHighlight | null;
}) {
  return (
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
        <g
          key={edge.id}
          className={cn(
            EDGE_TONE[edge.kind],
            DIM,
            highlight && !highlight.edges.has(edge.id) && "opacity-15",
          )}
        >
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
  );
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
      <span>Hover or focus a step to isolate its transitions</span>
      <span>Ctrl or ⌘ and scroll to zoom; with the canvas focused, + − and 0</span>
    </div>
  );
}
