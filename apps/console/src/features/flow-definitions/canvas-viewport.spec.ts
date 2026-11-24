import { describe, expect, it } from "vitest";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  anchoredScroll,
  canPan,
  centringInset,
  clampZoom,
  fitZoom,
  wheelZoom,
} from "./canvas-viewport";

describe("zoom", () => {
  it("keeps a level within the controls' range", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(0.1 + 0.2)).toBe(0.3);
  });

  it("zooms in on a wheel up and out on a wheel down, within the range", () => {
    const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({
      deltaY,
      deltaMode,
      ctrlKey,
    });
    expect(wheelZoom(1, wheel(-100))).toBeGreaterThan(1);
    expect(wheelZoom(1, wheel(100))).toBeLessThan(1);
    expect(wheelZoom(MAX_ZOOM, wheel(-100))).toBe(MAX_ZOOM);
    expect(wheelZoom(MIN_ZOOM, wheel(100))).toBe(MIN_ZOOM);
    // A notch in lines moves as far as the same notch in pixels, and a burst no further.
    expect(wheelZoom(1, wheel(3, 1))).toBeCloseTo(wheelZoom(1, wheel(48)));
    expect(wheelZoom(1, wheel(1000))).toBe(wheelZoom(1, wheel(100)));
    // A pinch's small deltas still move, and are not rounded away.
    expect(wheelZoom(1, wheel(-2.5, 0, true))).toBeGreaterThan(wheelZoom(1, wheel(-2.5)));
    // A mouse wheel with Ctrl held is a notch, not a pinch: it moves as far as ⌘ and the wheel.
    expect(wheelZoom(1, wheel(100, 0, true))).toBe(wheelZoom(1, wheel(100)));
    // However small its notch: one line a notch, or three reported in lines.
    expect(wheelZoom(1, wheel(33, 0, true))).toBe(wheelZoom(1, wheel(33)));
    expect(wheelZoom(1, wheel(3, 1, true))).toBe(wheelZoom(1, wheel(3, 1)));
    expect(wheelZoom(1, wheel(-1))).not.toBe(1);
  });

  it("centres a canvas that fits and starts one that overflows", () => {
    expect(centringInset(800, 1000, 0.5)).toBe(150);
    expect(centringInset(800, 1000, 1)).toBe(0);
  });

  it("keeps the point under the pointer in place, centred or scrolled", () => {
    const viewport = { width: 800, height: 400 };
    const canvas = { width: 2000, height: 600 };
    const pointer = { x: 200, y: 150 };
    // The canvas point under the pointer, given a scroll offset at a zoom.
    const under = (scroll: { left: number; top: number }, zoom: number) => ({
      x: (scroll.left + pointer.x - centringInset(viewport.width, canvas.width, zoom)) / zoom,
      y: (scroll.top + pointer.y - centringInset(viewport.height, canvas.height, zoom)) / zoom,
    });

    // Overflowing both before and after.
    const scrolled = { left: 300, top: 40 };
    const deeper = anchoredScroll(scrolled, pointer, viewport, canvas, 1, 1.5);
    expect(under(deeper, 1.5).x).toBeCloseTo(under(scrolled, 1).x);
    expect(under(deeper, 1.5).y).toBeCloseTo(under(scrolled, 1).y);

    // Vertically centred at 0.5 (300px of 400), overflowing at 1: the inset
    // it leaves is counted, so the point holds.
    const centred = { left: 100, top: 0 };
    const grown = anchoredScroll(centred, pointer, viewport, canvas, 0.5, 1);
    expect(under(grown, 1).y).toBeCloseTo(under(centred, 0.5).y);
    expect(under(grown, 1).x).toBeCloseTo(under(centred, 0.5).x);
  });

  it("asks for no scroll in an axis where the canvas fits", () => {
    const next = anchoredScroll(
      { left: 0, top: 0 },
      { x: 10, y: 10 },
      { width: 800, height: 400 },
      { width: 400, height: 200 },
      1,
      0.5,
    );
    expect(next).toEqual({ left: 0, top: 0 });
  });

  it("fits the canvas into the viewport, never above 100%", () => {
    expect(fitZoom({ width: 500, height: 400 }, { width: 1000, height: 400 })).toBe(0.5);
    expect(fitZoom({ width: 2000, height: 2000 }, { width: 1000, height: 400 })).toBe(1);
    expect(fitZoom({ width: 0, height: 0 }, { width: 1000, height: 400 })).toBe(1);
    // Rounded down: a fitted canvas never overflows, so it has nothing to pan.
    const viewport = { width: 1000, height: 800 };
    const canvas = { width: 1340, height: 400 };
    expect(fitZoom(viewport, canvas)).toBe(0.74);
    expect(canPan(viewport, canvas, fitZoom(viewport, canvas))).toBe(false);
  });

  it("pans only when the zoomed canvas overflows the viewport", () => {
    const viewport = { width: 800, height: 400 };
    expect(canPan(viewport, { width: 1000, height: 400 }, 0.5)).toBe(false);
    expect(canPan(viewport, { width: 1000, height: 400 }, 1)).toBe(true);
    expect(canPan(viewport, { width: 400, height: 600 }, 1)).toBe(true);
  });
});
