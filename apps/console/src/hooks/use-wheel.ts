import { type RefObject, useEffect, useRef } from "react";

/**
 * Calls `onWheel` for every wheel event over `ref`, attached natively and not
 * passive so the handler can `preventDefault` (React's `onWheel` is passive).
 */
export function useWheel(
  ref: RefObject<HTMLElement | null>,
  onWheel: (event: WheelEvent) => void,
): void {
  const handler = useRef(onWheel);
  handler.current = onWheel;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: WheelEvent) => handler.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [ref]);
}
