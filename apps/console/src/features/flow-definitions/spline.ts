/** A point in canvas pixels. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** One piece of a spline: a line, or a cubic with its two control points. */
interface SplinePiece {
  to: CanvasPoint;
  controls?: [CanvasPoint, CanvasPoint];
}

/** The point `t` of the way from `a` to `b`. */
function along(a: CanvasPoint, b: CanvasPoint, t: number): CanvasPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * A smooth curve through the bend points, as d3's `curveBasis` draws it: a
 * uniform B-spline whose pieces are cubics. Fewer than three points is a line.
 */
function splinePieces(points: CanvasPoint[]): { start: CanvasPoint; pieces: SplinePiece[] } {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points[points.length - 1] ?? first;
  if (points.length < 3) return { start: first, pieces: [{ to: last }] };

  let [a, b] = points as [CanvasPoint, CanvasPoint];
  const pieces: SplinePiece[] = [{ to: along(a, b, 1 / 6) }];
  const curveTo = (c: CanvasPoint) => {
    pieces.push({
      controls: [along(a, b, 1 / 3), along(a, b, 2 / 3)],
      // (a + 4b + c) / 6
      to: along(along(a, c, 1 / 2), b, 2 / 3),
    });
    a = b;
    b = c;
  };
  for (const point of points.slice(2)) curveTo(point);
  curveTo(b);
  pieces.push({ to: b });
  return { start: first, pieces };
}

/** The SVG path every arrow is drawn by. */
export function spline(points: CanvasPoint[]): string {
  if (points.length === 0) return "";
  const round = (value: number) => Math.round(value * 10) / 10;
  const at = (point: CanvasPoint) => `${round(point.x)},${round(point.y)}`;
  const { start, pieces } = splinePieces(points);
  return pieces.reduce(
    (path, { to, controls }) =>
      controls ? `${path} C${at(controls[0])} ${at(controls[1])} ${at(to)}` : `${path} L${at(to)}`,
    `M${at(start)}`,
  );
}

/** Points along the curve {@link spline} draws, to test it against the cards. */
export function sampleSpline(points: CanvasPoint[], steps = 12): CanvasPoint[] {
  const { start, pieces } = splinePieces(points);
  const samples = [start];
  let from = start;
  for (const { to, controls } of pieces) {
    const [one, two] = controls ?? [from, to];
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const u = 1 - t;
      samples.push({
        x: u * u * u * from.x + 3 * u * u * t * one.x + 3 * u * t * t * two.x + t * t * t * to.x,
        y: u * u * u * from.y + 3 * u * u * t * one.y + 3 * u * t * t * two.y + t * t * t * to.y,
      });
    }
    from = to;
  }
  return samples;
}
