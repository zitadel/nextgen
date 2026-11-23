import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { resolveLogoUrl } from "@zitadel/components";

import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import { Button } from "@/components/ui/button";
import type { BrandingRevision } from "@/features/branding/branding-palette";
import { brandingVariables } from "@/features/branding/branding-variables";
import { useDocumentTheme } from "@/hooks/use-document-theme";
import { useDragToPan } from "@/hooks/use-drag-to-pan";
import { useWheel } from "@/hooks/use-wheel";
import { cn } from "@/lib/utils";

import {
  type CanvasEdgeKind,
  type CanvasHighlight,
  type CardSize,
  type FlowCanvasLayout,
  ZOOM_STEP,
  anchoredScroll,
  clampZoom,
  fitZoom,
  highlightStep,
  layoutFlowCanvas,
  sameCardSizes,
  wheelZoom,
} from "../canvas";
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

/**
 * The definition drawn read-only: a card per step sketching its screen in the
 * project's branding, an arrow per transition. In the card it opens fitted;
 * full screen lifts it over the app shell at 100%.
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
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  const onMeasure = useCallback((next: Record<string, CardSize>) => {
    setSizes((current) => (sameCardSizes(current, next) ? current : next));
  }, []);
  const fit = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    setZoom(fitZoom({ width: element.clientWidth, height: element.clientHeight }, canvas));
  }, [canvas]);

  const current = useRef(zoom);
  current.current = zoom;
  const onWheel = useCallback((event: WheelEvent) => {
    const element = viewport.current;
    if (!element) return;
    event.preventDefault();
    const from = current.current;
    const to = wheelZoom(from, event);
    if (to === from) return;
    const box = element.getBoundingClientRect();
    const scroll = anchoredScroll(
      { left: element.scrollLeft, top: element.scrollTop },
      { x: event.clientX - box.left, y: event.clientY - box.top },
      from,
      to,
    );
    // The sizer has to grow before the new offsets fit inside it.
    flushSync(() => setZoom(to));
    element.scrollLeft = scroll.left;
    element.scrollTop = scroll.top;
  }, []);

  useLayoutEffect(() => {
    if (!full) return;
    setZoom(1);
    viewport.current?.scrollTo?.(0, 0);
  }, [full]);
  useLayoutEffect(() => {
    if (!full) fit();
  }, [full, fit]);

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

  const zoomControls = <ZoomControls zoom={zoom} onZoom={setZoom} onFit={fit} />;
  const stage = (
    <Viewport
      canvas={canvas}
      zoom={zoom}
      viewport={viewport}
      onWheel={onWheel}
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
            onClick={() => setFull(true)}
          >
            <Maximize2 aria-hidden />
            Full screen
          </Button>
        </div>
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
              {zoomControls}
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
            {stage}
          </div>,
          document.body,
        )
      ) : (
        <>
          {stage}
          <Legend />
        </>
      )}
    </DetailSection>
  );
}

function ZoomControls({
  zoom,
  onZoom,
  onFit,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
}) {
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
      <Button variant="secondary" size="sm" className={CARD_ACTION_BUTTON} onClick={onFit}>
        Fit
      </Button>
    </div>
  );
}

/**
 * Scrolls both ways and pans by drag. Cards are measured after each render
 * and reported, so the layout places them by their real size.
 */
function Viewport({
  canvas,
  zoom,
  viewport,
  onWheel,
  branding,
  onMeasure,
  className,
}: {
  canvas: FlowCanvasLayout;
  zoom: number;
  viewport: RefObject<HTMLElement | null>;
  onWheel: (event: WheelEvent) => void;
  branding?: BrandingRevision;
  onMeasure: (sizes: Record<string, CardSize>) => void;
  className: string;
}) {
  const dragging = useDragToPan(viewport);
  useWheel(viewport, onWheel);
  const side = useDocumentTheme();
  const variables = useMemo(() => brandingVariables(branding, side), [branding, side]);
  const logo = resolveLogoUrl(branding, side);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlight = useMemo(
    () => (highlighted ? highlightStep(canvas, highlighted) : null),
    [canvas, highlighted],
  );
  const cards = useRef(new Map<string, HTMLElement>());

  const measure = useRef(() => {});
  measure.current = () => {
    const next: Record<string, CardSize> = {};
    for (const [name, element] of cards.current) {
      // Unlaid out (a test's DOM) reads zero: keep the estimate.
      if (element.offsetHeight === 0) continue;
      const ports: Record<string, number> = {};
      for (const control of element.querySelectorAll<HTMLElement>("[data-port]")) {
        const port = control.dataset.port;
        if (port) ports[port] = control.offsetTop + control.offsetHeight / 2;
      }
      next[name] = { height: element.offsetHeight, ports };
    }
    if (Object.keys(next).length > 0) onMeasure(next);
  };
  useLayoutEffect(() => measure.current());
  // Fonts and the logo land after the first paint.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure.current());
    for (const element of cards.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [canvas.cards]);

  return (
    <section
      ref={viewport}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus to scroll
      tabIndex={0}
      aria-label="Flow canvas"
      className={cn(
        "overflow-auto bg-background outline-none focus-visible:ring-2",
        dragging ? "cursor-grabbing select-none" : "cursor-grab",
        className,
      )}
    >
      <div style={{ width: canvas.width * zoom, height: canvas.height * zoom }}>
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
    </div>
  );
}
