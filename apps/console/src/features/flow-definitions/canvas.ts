import { graphlib, layout } from "@dagrejs/dagre";

import type { FlowDefinition, FlowStep } from "./model";

/**
 * Geometry for the read-only flow canvas: one card per step, laid out left to
 * right, an arrow per transition. Computed from the definition on every render;
 * nothing about the drawing is stored.
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

export type SketchRowKind = keyof typeof ROW_HEIGHT;

/** One control of a step's screen, placed from the card's top edge. */
export interface SketchRow {
  kind: SketchRowKind;
  label: string;
  primary?: boolean;
  top: number;
  height: number;
}

/** A step drawn as the screen it renders. `ports` maps an action to its control's centre. */
export interface StepSketch {
  rows: SketchRow[];
  height: number;
  footer?: { label: string; value: string };
  ports: Record<string, number>;
}

export type CanvasEdgeKind = "action" | "outcome" | "purpose" | "entry";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasEdge {
  id: string;
  kind: CanvasEdgeKind;
  /** SVG path data. */
  path: string;
  /** The transition's name; an entry arrow has none. */
  label?: string;
  labelAt?: CanvasPoint;
}

/** A card's top-left corner and its sketch. */
export interface CanvasCard {
  name: string;
  x: number;
  y: number;
  sketch: StepSketch;
}

/** A purpose's entry pill, by its top-left corner. */
export interface CanvasPill {
  purpose: string;
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
  const buttons = actions.filter((action) => action.kind !== "navigate");
  const links = actions.filter((action) => action.kind === "navigate");
  const specs: { kind: SketchRowKind; label: string; primary?: boolean; action?: string }[] = [
    ...(step.fields ?? []).map((field) => ({ kind: "field" as const, label: field })),
    ...buttons.map((action) => ({
      kind: "button" as const,
      label: action.name,
      primary: action.primary ?? false,
      action: action.name,
    })),
  ];
  if (providers.length > 0 && specs.length > 0) specs.push({ kind: "divider", label: "or" });
  specs.push(...providers.map((provider) => ({ kind: "provider" as const, label: provider })));
  specs.push(
    ...links.map((action) => ({ kind: "link" as const, label: action.name, action: action.name })),
  );

  const rows: SketchRow[] = [];
  const ports: Record<string, number> = {};
  let y = HEADER_HEIGHT + BODY_INSET;
  for (const { action, ...spec } of specs) {
    const height = ROW_HEIGHT[spec.kind];
    rows.push({ ...spec, top: y, height });
    if (action) ports[action] = y + height / 2;
    y += height + ROW_GAP;
  }
  const footer = step.on_success
    ? { label: "on success", value: step.on_success }
    : step.complete
      ? { label: "complete", value: step.complete }
      : undefined;
  const body = rows.length > 0 ? y - ROW_GAP + BODY_INSET : HEADER_HEIGHT;
  return { rows, height: body + (footer ? FOOTER_HEIGHT : 0), footer, ports };
}

const pillId = (purpose: string) => `purpose:${purpose}`;

/**
 * Positions for every card, pill and arrow. Purpose transitions stay out of the
 * ranking: they may point left, and the cycle would pull a pill away from its
 * entry step. They are routed by hand once the rest is placed.
 */
export function layoutFlowCanvas(definition: FlowDefinition): FlowCanvasLayout {
  const steps = definition.steps ?? [];
  const purposes = Object.entries(definition.purposes ?? {});
  const stepNames = new Set(steps.map((step) => step.name));
  const sketches = new Map(steps.map((step) => [step.name, stepSketch(step)]));

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
  for (const [name, sketch] of sketches) {
    graph.setNode(name, { width: CANVAS_CARD_WIDTH, height: sketch.height });
  }

  const meta = new Map<string, { kind: CanvasEdgeKind; label?: string }>();
  for (const [purpose, entry] of purposes) {
    if (!stepNames.has(entry)) continue;
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
    // An action's arrow leaves from its control, on the side it heads to.
    const port = label === undefined ? undefined : sketches.get(ref.v)?.ports[label];
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
    const port = top + (sketches.get(jump.from)?.ports[jump.label] ?? from.height / 2);
    const right = from.x + CANVAS_CARD_WIDTH / 2;
    const pillLeft = pill.x - pill.width / 2;
    const id = `${jump.from}.${jump.label}`;
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
    edges.push({ id, kind: "purpose", path, label: jump.label, labelAt });
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
        sketch: sketches.get(step.name) as StepSketch,
      };
    }),
    pills: purposes.map(([purpose]) => {
      const { x, y, width } = node(pillId(purpose));
      return { purpose, x: x - width / 2, y: y - PILL_HEIGHT / 2, width, height: PILL_HEIGHT };
    }),
    edges,
  };
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
