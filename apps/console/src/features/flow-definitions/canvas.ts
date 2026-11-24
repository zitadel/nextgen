import { graphlib, layout } from "@dagrejs/dagre";

import type { FlowDefinition, FlowStep } from "./model";
import { type CanvasPoint, sampleSpline, spline } from "./spline";

/**
 * Geometry for the read-only flow canvas: one card per step, laid out left to
 * right, an arrow per transition. A pure function of the definition and the
 * measured card sizes; nothing about the drawing is stored.
 */

export const CANVAS_CARD_WIDTH = 240;

/**
 * Card dimensions for the first layout, before the cards are measured. They
 * follow the classes in `step-card.tsx`; a drift only costs one re-layout.
 */
const HEADER_HEIGHT = 32;
const BODY_INSET = 12;
const ROW_GAP = 8;
const FOOTER_HEIGHT = 28;
const ROW_HEIGHT = { field: 52, button: 32, divider: 16, provider: 32, link: 20 } as const;

const PILL_HEIGHT = 28;
/** One character of the 11px mono labels, to size them before they render. */
const LABEL_CHAR = 6.7;

/** Purpose arrows that run back under the cards: first lane's gap, its step, the gap between arrows. */
const LANE_GAP = 12;
const LANE_SINK = 24;
const LANE_SPACING = 18;
const MAX_SINKS = 8;
/** Room under the lowest arc for its label. */
const LABEL_ROOM = 24;

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

export type { CanvasPoint };

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

/** A transition's arrow id. Names may hold any character, so the pair is encoded, not joined. */
export function edgeId(from: string, label: string): string {
  return JSON.stringify([from, label]);
}

interface Box {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PlacedNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Positions for every card, pill and arrow. A step missing from `sizes` is
 * placed by its estimate. Purpose transitions stay out of the ranking: they
 * may point left, and the cycle would pull a pill away from its entry step.
 * They are routed by {@link PurposeRouter} once the rest is placed.
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
      const id = edgeId(step.name, label);
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

  const node = (name: string): PlacedNode => {
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

  const boxes: Box[] = steps.map((step) => {
    const { x, y, height } = node(step.name);
    const half = CANVAS_CARD_WIDTH / 2;
    return {
      name: step.name,
      left: x - half,
      right: x + half,
      top: y - height / 2,
      bottom: y + height / 2,
    };
  });
  const router = new PurposeRouter(graph.graph().height ?? 0, boxes);
  for (const jump of jumps) {
    const from = node(jump.from);
    const port = sizeOf(jump.from)?.ports[jump.label] ?? from.height / 2;
    const { points, labelAt } = router.route(
      jump.from,
      from,
      port,
      node(pillId(jump.purpose)),
      jump.label,
    );
    edges.push({
      id: edgeId(jump.from, jump.label),
      kind: "purpose",
      from: jump.from,
      to: pillId(jump.purpose),
      path: spline(points),
      label: jump.label,
      labelAt,
    });
  }

  return {
    width: graph.graph().width ?? 0,
    height: router.height,
    cards: steps.map((step) => {
      const { x, y, height } = node(step.name);
      return {
        name: step.name,
        x: x - CANVAS_CARD_WIDTH / 2,
        y: y - height / 2,
        height,
        sketch: sketches.get(step.name) ?? stepSketch(step),
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

/**
 * Routes purpose arrows by hand, in one of three shapes by where the pill sits:
 * ahead of the card, in its column, or behind it. Arrows behind it run in
 * lanes under every card, each lower than the last, and grow the canvas.
 */
class PurposeRouter {
  height: number;
  private lane: number;
  private readonly boxes: Box[];

  constructor(graphHeight: number, boxes: Box[]) {
    this.boxes = boxes;
    this.height = graphHeight;
    this.lane = graphHeight + LANE_GAP;
  }

  route(
    name: string,
    from: PlacedNode,
    port: number,
    pill: PlacedNode,
    label: string,
  ): { points: CanvasPoint[]; labelAt: CanvasPoint } {
    const right = from.x + CANVAS_CARD_WIDTH / 2;
    const pillLeft = pill.x - pill.width / 2;
    if (pillLeft >= right) return this.ahead(from, port, pill, right, pillLeft);
    if (Math.abs(pill.x - from.x) < CANVAS_CARD_WIDTH / 2)
      return this.sameColumn(from, pill, label);
    return this.behind(name, from, pill);
  }

  /** The pill is to the right: out of the control, across, and in. */
  private ahead(from: PlacedNode, port: number, pill: PlacedNode, right: number, pillLeft: number) {
    const portY = from.y - from.height / 2 + port;
    const mid = (right + pillLeft) / 2;
    return {
      points: [
        { x: right, y: portY },
        { x: mid, y: portY },
        { x: mid, y: pill.y },
        { x: pillLeft, y: pill.y },
      ],
      labelAt: { x: mid, y: (portY + pill.y) / 2 },
    };
  }

  /** The pill shares the card's column: a short arrow from the edge facing it. */
  private sameColumn(from: PlacedNode, pill: PlacedNode, label: string) {
    const up = pill.y < from.y;
    const start = from.y + ((up ? -1 : 1) * from.height) / 2;
    const end = pill.y + ((up ? 1 : -1) * PILL_HEIGHT) / 2;
    return {
      points: [
        { x: pill.x, y: start },
        { x: pill.x, y: end },
      ],
      labelAt: { x: pill.x + labelWidth(label) / 2 + 6, y: (start + end) / 2 + 10 },
    };
  }

  /**
   * The pill is behind the card: an arc down from the card, under every row
   * and up into the pill, sunk lane by lane until it clears every other card.
   * A card straight under this one is never cleared by sinking, so then the
   * first lane is kept.
   */
  private behind(name: string, from: PlacedNode, pill: PlacedNode) {
    const others = this.boxes.filter((box) => box.name !== name);
    const arc = (depth: number) => [
      { x: from.x, y: from.y + from.height / 2 },
      { x: from.x, y: depth },
      { x: pill.x, y: depth },
      { x: pill.x, y: pill.y + PILL_HEIGHT / 2 },
    ];
    const first = this.lane;
    let points = arc(this.lane);
    for (let sunk = 0; sunk < MAX_SINKS && crossesBox(points, others); sunk++) {
      this.lane += LANE_SINK;
      points = arc(this.lane);
    }
    if (crossesBox(points, others)) {
      this.lane = first;
      points = arc(this.lane);
    }
    const lowest = sampleSpline(points).reduce((low, point) => (point.y > low.y ? point : low));
    this.height = Math.max(this.height, lowest.y + LABEL_ROOM);
    this.lane += LANE_SPACING;
    return { points, labelAt: lowest };
  }
}

/** What stays lit while a step is hovered or focused; everything else dims. */
export interface CanvasHighlight {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * The step, the transitions into and out of it and the steps at their other
 * ends. A purpose transition counts through its pill: one out of the step
 * lights the pill, its entry arrow and the entry step, and one into a pill
 * the step is the entry of lights the step it leaves.
 */
export function highlightStep(canvas: FlowCanvasLayout, step: string): CanvasHighlight {
  const nodes = new Set([step]);
  const edges = new Set<string>();
  const light = (edge: CanvasEdge, other: string) => {
    edges.add(edge.id);
    nodes.add(other);
  };
  const entries = canvas.edges.filter((edge) => edge.kind === "entry");
  const ownPills = new Set(entries.filter((edge) => edge.to === step).map((edge) => edge.from));
  const targetPills = new Set<string>();
  for (const edge of canvas.edges) {
    if (edge.kind === "entry") continue;
    if (edge.from === step) {
      light(edge, edge.to);
      if (edge.kind === "purpose") targetPills.add(edge.to);
    } else if (edge.to === step || ownPills.has(edge.to)) {
      light(edge, edge.from);
    }
  }
  for (const edge of entries) {
    if (edge.to === step) light(edge, edge.from);
    else if (targetPills.has(edge.from)) light(edge, edge.to);
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

function pillWidth(purpose: string): number {
  return purpose.length * LABEL_CHAR + 30;
}

function labelWidth(label: string): number {
  return label.length * LABEL_CHAR + 14;
}

function crossesBox(points: CanvasPoint[], boxes: Box[]): boolean {
  return sampleSpline(points).some((point) =>
    boxes.some(
      (box) =>
        point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom,
    ),
  );
}
