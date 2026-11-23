import { type RefObject, useEffect, useState } from "react";

/**
 * Scrolls `ref` by dragging it with the primary button. A press on its own
 * scrollbar is left to the browser, and nothing is prevented, so a press
 * still focuses what it lands on. Returns whether a drag is under way.
 */
export function useDragToPan(ref: RefObject<HTMLElement | null>): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let start: { x: number; y: number; left: number; top: number } | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
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
      };
    };
    const onMove = (event: PointerEvent) => {
      if (!start) return;
      setDragging(true);
      element.scrollLeft = start.left - (event.clientX - start.x);
      element.scrollTop = start.top - (event.clientY - start.y);
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
