import { useCallback, useEffect, useState } from "react";

/** Which edges of a horizontal scroller have content scrolled under them. */
export interface ScrollEdges {
  /** Content is scrolled out past the leading edge. */
  start: boolean;
  /** Content runs on past the trailing edge. */
  end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/**
 * Tracks which edges of a horizontally scrolling table have content under
 * them, so a sticky column can draw its divider only while something sits
 * beneath it.
 *
 * The ref goes on the card around a `Table`. The element that scrolls is the
 * table's own container (`data-slot="table-container"`), which `Table` renders
 * and does not expose, so it is found inside the card; the card itself is the
 * fallback.
 */
export function useScrollEdges() {
  const [wrap, setWrap] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  useEffect(() => {
    if (!wrap) return;
    const scroller = wrap.querySelector<HTMLElement>('[data-slot="table-container"]') ?? wrap;
    const measure = () => {
      const { scrollLeft, scrollWidth, clientWidth } = scroller;
      // A pixel of slack: a zoomed page reports fractional widths, and a
      // fully scrolled table can stop a sub-pixel short of `scrollWidth`.
      const next = { start: scrollLeft > 0, end: scrollLeft + clientWidth < scrollWidth - 1 };
      setEdges((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    // The card resizes with the window, the table with the rows and columns it
    // is given; either can start or stop the overflow without a scroll.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [wrap]);

  const ref = useCallback((element: HTMLElement | null) => setWrap(element), []);
  return { ref, edges };
}
