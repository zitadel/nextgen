import { graphlib, layout } from "@dagrejs/dagre";

import type { FlowDefinition, FlowStep } from "./model";

/**
 * Geometry for the read-only flow canvas: one card per step, laid out left to
 * right, an arrow per transition. A pure function of the definition and the
 * measured card sizes; nothing about the drawing is stored.
 */

export const CANVAS_CARD_WIDTH = 240;
const HEADER_HEIGHT = 32;
const BODY_INSET = 12;
const ROW_GAP = 8;
const FOOTER_HEIGHT = 28;
const PILL_HEIGHT = 28;
/** One character of the 11px mono labels, to size them before they render. */
const LABEL_CHAR = 6.7;

const ROW_HEIGHT = { field: 52, button: 32, divider: 16, provider: 32, link: 20 } as const;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 1.5;
export const ZOOM_STEP = 0.1;

export type SketchRowKind = keyof typeof ROW_HEIGHT;

/** One control of a step's screen. `action` names the action it fires. */
export interface SketchRow {
  kind: SketchRowKind;
  label: string;
  primary?: boolean;
  action?: string;
}

/** A card's height, and each action's control centre from the card's top edge. */
export interface CardSize {
  height: number;
  ports: Record<string, number>;
}

/** A step drawn as the screen it renders, with a size to place it by until it is measured. */
export interface StepSketch {
  rows: SketchRow[];
  footer?: { label: string; value: string };
  estimate: CardSize;
}

export type CanvasEdgeKind = "action" | "outcome" | "purpose" | "entry";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasEdge {
  id: string;
  kind: CanvasEdgeKind;
  /** Node ids: a step's name, or a pill's {@link CanvasPill.id}. */
  from: string;
  to: string;
  /** SVG path data. */
  path: string;
  /** The transition's name; an entry arrow has none. */
  label?: string;
  labelAt?: CanvasPoint;
}

/** A card's top-left corner, its height and its sketch. */
export interface CanvasCard {
  name: string;
  x: number;
  y: number;
  height: number;
  sketch: StepSketch;
}

/** A purpose's entry pill, by its top-left corner. */
export interface CanvasPill {
  purpose: string;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowCanvasLayout {
  width: number;
  height: number;
  cards: CanvasCard[];
  pills: CanvasPill[];
  edges: CanvasEdge[];
}

/** Rows in screen order: fields, buttons, SSO providers, then links. */
export function stepSketch(step: FlowStep): StepSketch {
  const actions = step.actions ?? [];
  const providers = step.sso_providers ?? [];
  const rows: SketchRow[] = [
    ...(step.fields ?? []).map((field) => ({ kind: "field" as const, label: field })),
    ...actions
      .filter((action) => action.kind !== "navigate")
      .map((action) => ({
        kind: "button" as const,
        label: action.name,
        primary: action.primary ?? false,
        action: action.name,
      })),
  ];
  if (providers.length > 0 && rows.length > 0) rows.push({ kind: "divider", label: "or" });
  rows.push(...providers.map((provider) => ({ kind: "provider" as const, label: provider })));
  rows.push(
    ...actions
      .filter((action) => action.kind === "navigate")
      .map((action) => ({ kind: "link" as const, label: action.name, action: action.name })),
  );
  const footer = step.on_success
    ? { label: "on success", value: step.on_success }
    : step.complete
      ? { label: "complete", value: step.complete }
      : undefined;
  return { rows, footer, estimate: estimateSize(rows, footer !== undefined) };
}

function estimateSize(rows: SketchRow[], footer: boolean): CardSize {
  const ports: Record<string, number> = {};
  let y = HEADER_HEIGHT + BODY_INSET;
  for (const row of rows) {
    const height = ROW_HEIGHT[row.kind];
    if (row.action) ports[row.action] = y + height / 2;
    y += height + ROW_GAP;
  }
  const body = rows.length > 0 ? y - ROW_GAP + BODY_INSET : HEADER_HEIGHT;
  return { height: body + (footer ? FOOTER_HEIGHT : 0), ports };
}

const pillId = (purpose: string) => `purpose:${purpose}`;

/**
 * Positions for every card, pill and arrow. A step missing from `sizes` is
 * placed by its estimate. Purpose transitions stay out of the ranking: they
 * may point left, and the cycle would pull a pill away from its entry step.
 * They are routed by hand once the rest is placed.
 */
export function layoutFlowCanvas(
  definition: FlowDefinition,
  sizes: Readonly<Record<string, CardSize>> = {},
): FlowCanvasLayout {
  const steps = definition.steps ?? [];
  const purposes = Object.entries(definition.purposes ?? {});
  const stepNames = new Set(steps.map((step) => step.name));
  const sketches = new Map(steps.map((step) => [step.name, stepSketch(step)]));
  const sizeOf = (name: string): CardSize | undefined =>
    sizes[name] ?? sketches.get(name)?.estimate;

  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 44,
    ranksep: 64,
    edgesep: 22,
    marginx: 28,
    marginy: 36,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const [purpose] of purposes) {
    graph.setNode(pillId(purpose), { width: pillWidth(purpose), height: PILL_HEIGHT });
  }
  for (const name of sketches.keys()) {
    graph.setNode(name, { width: CANVAS_CARD_WIDTH, height: sizeOf(name)?.height ?? 0 });
  }

  const meta = new Map<string, { kind: CanvasEdgeKind; label?: string }>();
  for (const [purpose, entry] of purposes) {
    if (!entry || !stepNames.has(entry)) continue;
    const id = `entry:${purpose}`;
    meta.set(id, { kind: "entry" });
    graph.setEdge(pillId(purpose), entry, {}, id);
  }
  const jumps: { from: string; label: string; purpose: string }[] = [];
  const declared = new Set(purposes.map(([purpose]) => purpose));
  for (const step of steps) {
    const actionNames = new Set((step.actions ?? []).map((action) => action.name));
    for (const [label, transition] of Object.entries(step.transitions ?? {})) {
      if (transition.purpose) {
        if (declared.has(transition.purpose)) {
          jumps.push({ from: step.name, label, purpose: transition.purpose });
        }
        continue;
      }
      // A cross-flow target names no step here, so there is nothing to point at.
      if (!transition.target || !stepNames.has(transition.target)) continue;
      const id = `${step.name}.${label}`;
      meta.set(id, { kind: actionNames.has(label) ? "action" : "outcome", label });
      graph.setEdge(
        step.name,
        transition.target,
        { width: labelWidth(label), height: 20, labelpos: "c" },
        id,
      );
    }
  }

  layout(graph);

  const node = (name: string) => {
    const { x = 0, y = 0, width, height } = graph.node(name);
    return { x, y, width, height };
  };
  const edges: CanvasEdge[] = graph.edges().map((ref) => {
    const id = ref.name ?? `${ref.v}->${ref.w}`;
    const { kind, label } = meta.get(id) ?? { kind: "entry" as const };
    const edge = graph.edge(ref);
    const points: CanvasPoint[] = (edge.points ?? []).map(({ x, y }: CanvasPoint) => ({ x, y }));
    // An action's arrow leaves from its control, on the side it heads to; one
    // whose control was not found leaves from the card's edge.
    const port = label === undefined ? undefined : sizeOf(ref.v)?.ports[label];
    if (kind === "action" && port !== undefined && points.length > 1) {
      const from = node(ref.v);
      const side = (points[1]?.x ?? from.x) >= from.x ? 1 : -1;
      points[0] = {
        x: from.x + (side * CANVAS_CARD_WIDTH) / 2,
        y: from.y - from.height / 2 + port,
      };
    }
    return {
      id,
      kind,
      from: ref.v,
      to: ref.w,
      path: spline(points),
      label,
      labelAt: label === undefined ? undefined : { x: edge.x ?? 0, y: edge.y ?? 0 },
    };
  });

  const graphHeight = graph.graph().height ?? 0;
  let height = graphHeight;
  let lanes = 0;
  for (const jump of jumps) {
    const from = node(jump.from);
    const pill = node(pillId(jump.purpose));
    const top = from.y - from.height / 2;
    const port = top + (sizeOf(jump.from)?.ports[jump.label] ?? from.height / 2);
    const right = from.x + CANVAS_CARD_WIDTH / 2;
    const pillLeft = pill.x - pill.width / 2;
    let path: string;
    let labelAt: CanvasPoint;
    if (pillLeft >= right) {
      const mid = (right + pillLeft) / 2;
      path = `M${right},${port} C${mid},${port} ${mid},${pill.y} ${pillLeft},${pill.y}`;
      labelAt = { x: mid, y: (port + pill.y) / 2 };
    } else if (Math.abs(pill.x - from.x) < CANVAS_CARD_WIDTH / 2) {
      // The pill shares the card's column: a short arrow from the edge facing it.
      const up = pill.y < from.y;
      const start = from.y + ((up ? -1 : 1) * from.height) / 2;
      const end = pill.y + ((up ? 1 : -1) * PILL_HEIGHT) / 2;
      path = `M${pill.x},${start} L${pill.x},${end}`;
      labelAt = { x: pill.x + labelWidth(jump.label) / 2 + 6, y: (start + end) / 2 + 10 };
    } else {
      // The pill is behind the card: run under every row, one lane per arrow.
      const lane = graphHeight + 12 + 18 * lanes++;
      const bottom = from.y + from.height / 2;
      const turn = pill.x < from.x ? -12 : 12;
      path =
        `M${from.x},${bottom} L${from.x},${lane - 12} Q${from.x},${lane} ${from.x + turn},${lane} ` +
        `L${pill.x - turn},${lane} Q${pill.x},${lane} ${pill.x},${lane - 12} ` +
        `L${pill.x},${pill.y + PILL_HEIGHT / 2}`;
      labelAt = { x: (from.x + pill.x) / 2, y: lane };
      height = lane + 24;
    }
    edges.push({
      id: `${jump.from}.${jump.label}`,
      kind: "purpose",
      from: jump.from,
      to: pillId(jump.purpose),
      path,
      label: jump.label,
      labelAt,
    });
  }

  return {
    width: graph.graph().width ?? 0,
    height,
    cards: steps.map((step) => {
      const { x, y, height: cardHeight } = node(step.name);
      return {
        name: step.name,
        x: x - CANVAS_CARD_WIDTH / 2,
        y: y - cardHeight / 2,
        height: cardHeight,
        sketch: sketches.get(step.name) as StepSketch,
      };
    }),
    pills: purposes.map(([purpose]) => {
      const { x, y, width } = node(pillId(purpose));
      return {
        purpose,
        id: pillId(purpose),
        x: x - width / 2,
        y: y - PILL_HEIGHT / 2,
        width,
        height: PILL_HEIGHT,
      };
    }),
    edges,
  };
}

/** What stays lit while a step is hovered or focused; everything else dims. */
export interface CanvasHighlight {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * The step, its outgoing transitions and their targets. A purpose transition
 * also lights the pill's entry arrow and the entry step.
 */
export function highlightStep(canvas: FlowCanvasLayout, step: string): CanvasHighlight {
  const nodes = new Set([step]);
  const edges = new Set<string>();
  for (const edge of canvas.edges) {
    if (edge.kind === "entry" || edge.from !== step) continue;
    edges.add(edge.id);
    nodes.add(edge.to);
  }
  for (const edge of canvas.edges) {
    if (edge.kind !== "entry" || !nodes.has(edge.from)) continue;
    edges.add(edge.id);
    nodes.add(edge.to);
  }
  return { nodes, edges };
}

/** Whether two measurements agree to the pixel, so a re-measure that changes nothing re-lays nothing. */
export function sameCardSizes(
  current: Readonly<Record<string, CardSize>>,
  next: Readonly<Record<string, CardSize>>,
): boolean {
  const names = Object.keys(next);
  if (names.length !== Object.keys(current).length) return false;
  return names.every((name) => {
    const [a, b] = [current[name], next[name]];
    if (!a || !b || Math.round(a.height) !== Math.round(b.height)) return false;
    const ports = Object.keys(b.ports);
    return (
      ports.length === Object.keys(a.ports).length &&
      ports.every((port) => Math.round(a.ports[port] ?? -1) === Math.round(b.ports[port] ?? -1))
    );
  });
}

/** A zoom level kept within the steps the controls offer. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** Pixels per wheel line and page, for a wheel that reports in those units. */
const WHEEL_UNIT = [1, 16, 800] as const;

/**
 * The zoom after one wheel event: exponential in the delta, so many small
 * trackpad events and one notch of a mouse wheel cover the same ground. A
 * pinch arrives as ctrl+wheel with small deltas, so it scales faster. Not
 * rounded, or a run of small deltas would never move off a step.
 */
export function wheelZoom(
  zoom: number,
  wheel: { deltaY: number; deltaMode: number; ctrlKey: boolean },
): number {
  const pixels = wheel.deltaY * (WHEEL_UNIT[wheel.deltaMode as 0 | 1 | 2] ?? 1);
  // One notch is about 100px; a larger burst should not jump further.
  const delta = Math.max(-100, Math.min(100, pixels));
  const next = zoom * Math.exp(-delta * (wheel.ctrlKey ? 0.01 : 0.0015));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/**
 * The scroll offsets that keep the canvas point under `pointer` (relative to
 * the viewport's corner) under it when the zoom goes `from` → `to`.
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  pointer: CanvasPoint,
  from: number,
  to: number,
): { left: number; top: number } {
  const scale = to / from;
  return {
    left: (scroll.left + pointer.x) * scale - pointer.x,
    top: (scroll.top + pointer.y) * scale - pointer.y,
  };
}

/** The zoom that shows the whole canvas in the viewport, never above 100%. */
export function fitZoom(
  viewport: { width: number; height: number },
  canvas: { width: number; height: number },
): number {
  if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  return clampZoom(Math.min(1, viewport.width / canvas.width, viewport.height / canvas.height));
}

function pillWidth(purpose: string): number {
  return purpose.length * LABEL_CHAR + 30;
}

function labelWidth(label: string): number {
  return label.length * LABEL_CHAR + 14;
}

/** A smooth path through the layout's bend points (d3's `curveBasis`). */
function spline(points: CanvasPoint[]): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  const at = (point: CanvasPoint) => `${round(point.x)},${round(point.y)}`;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  if (points.length < 3) return `M${at(first)} L${at(last)}`;
  let [a, b] = points as [CanvasPoint, CanvasPoint];
  let path = `M${at(a)} L${at({ x: (5 * a.x + b.x) / 6, y: (5 * a.y + b.y) / 6 })}`;
  const curve = (c: CanvasPoint) => {
    path +=
      ` C${at({ x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 })}` +
      ` ${at({ x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 })}` +
      ` ${at({ x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 })}`;
    a = b;
    b = c;
  };
  for (const point of points.slice(2)) curve(point);
  curve(b);
  return `${path} L${at(b)}`;
}
