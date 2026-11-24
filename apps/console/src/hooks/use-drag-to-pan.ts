import { type RefObject, useEffect, useState } from "react";

/** How far a press moves before it is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * Scrolls `ref` by dragging it with the primary button, once the press has
 * moved past a few pixels and only while `ref` has something to scroll. A
 * press on its own scrollbar is left to the browser, and nothing is
 * prevented, so a press still focuses what it lands on. Returns whether a
 * drag is under way.
 */
export function useDragToPan(ref: RefObject<HTMLElement | null>): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let start: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const scrollable =
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
      if (!scrollable) return;
      const box = element.getBoundingClientRect();
      // Past the client area is the scrollbar.
      if (
        event.clientX - box.left > element.clientWidth ||
        event.clientY - box.top > element.clientHeight
      ) {
        return;
      }
      start = {
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
        moved: false,
      };
    };
    const onMove = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        start.moved = true;
        // The press may have begun selecting the text under it.
        window.getSelection()?.removeAllRanges();
        setDragging(true);
      }
      element.scrollLeft = start.left - dx;
      element.scrollTop = start.top - dy;
    };
    const onUp = () => {
      start = null;
      setDragging(false);
    };

    element.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [ref]);

  return dragging;
}
