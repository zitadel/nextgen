import type { CanvasPoint } from "./spline";

/**
 * Zoom and scroll arithmetic for the canvas viewport: pure functions of the
 * viewport, the canvas size and the zoom, so the component only applies them.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 1.5;
export const ZOOM_STEP = 0.1;

interface Size {
  width: number;
  height: number;
}

/** A zoom level kept within the steps the controls offer. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** Pixels per wheel line and page, for a wheel that reports in those units. */
const WHEEL_UNIT = [1, 16, 800] as const;
/** A pinch's events stay well under a mouse wheel's notch of about 100px. */
const PINCH_MAX_DELTA = 50;

/**
 * The zoom after one zooming wheel event: exponential in the delta, so many
 * small trackpad events and one notch of a mouse wheel cover the same ground.
 * A pinch arrives as ctrl+wheel with small deltas, so it scales faster; a
 * mouse wheel turned with Ctrl held reports whole notches and does not. Not
 * rounded, or a run of small deltas would never move off a step.
 */
export function wheelZoom(
  zoom: number,
  wheel: { deltaY: number; deltaMode: number; ctrlKey: boolean },
): number {
  const pixels = wheel.deltaY * (WHEEL_UNIT[wheel.deltaMode as 0 | 1 | 2] ?? 1);
  // One notch is about 100px; a larger burst should not jump further.
  const delta = Math.max(-100, Math.min(100, pixels));
  const pinch = wheel.ctrlKey && Math.abs(pixels) < PINCH_MAX_DELTA;
  const next = zoom * Math.exp(-delta * (pinch ? 0.01 : 0.0015));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/**
 * Where the canvas starts in the viewport along one axis: centred while it
 * fits, at the start once it overflows and scrolls.
 */
export function centringInset(viewport: number, canvas: number, zoom: number): number {
  return Math.max(0, (viewport - canvas * zoom) / 2);
}

/**
 * The scroll offsets that keep the canvas point under `pointer` (relative to
 * the viewport's corner) under it when the zoom goes `from` → `to`, with the
 * canvas centred in any axis where it fits. In an axis where it still fits at
 * `to` there is nothing to scroll, so the centring places it instead.
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  pointer: CanvasPoint,
  viewport: Size,
  canvas: Size,
  from: number,
  to: number,
): { left: number; top: number } {
  const axis = (offset: number, at: number, view: number, size: number) => {
    const point = (offset + at - centringInset(view, size, from)) / from;
    const end = Math.max(0, size * to - view);
    return Math.min(end, Math.max(0, point * to + centringInset(view, size, to) - at));
  };
  return {
    left: axis(scroll.left, pointer.x, viewport.width, canvas.width),
    top: axis(scroll.top, pointer.y, viewport.height, canvas.height),
  };
}

/** The zoom that shows the whole canvas in the viewport, never above 100%. Rounded down, so it never overflows. */
export function fitZoom(viewport: Size, canvas: Size): number {
  if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  const fit = Math.min(1, viewport.width / canvas.width, viewport.height / canvas.height);
  return Math.max(MIN_ZOOM, Math.floor(fit * 100) / 100);
}

/** Whether the canvas at `zoom` overflows the viewport, so there is something to pan. */
export function canPan(viewport: Size, canvas: Size, zoom: number): boolean {
  return canvas.width * zoom > viewport.width + 1 || canvas.height * zoom > viewport.height + 1;
}
