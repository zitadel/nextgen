"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Leans the centerpiece toward the pointer: sets --tilt-x and --tilt-y, from
// -0.5 to 0.5, which globals.css turns into a tilt of the animation, a drift of
// its light and a parallax of the caption. Off on touch screens and for
// reduced motion; back to rest when the pointer leaves the window.
export function Stage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = root.current;
    const pointer = window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)");
    if (!stage || !pointer.matches) {
      return;
    }

    let frame = 0;
    const tilt = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        stage.style.setProperty("--tilt-x", x.toFixed(3));
        stage.style.setProperty("--tilt-y", y.toFixed(3));
      });
    };
    const follow = (event: PointerEvent) =>
      tilt(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
    const rest = () => tilt(0, 0);

    window.addEventListener("pointermove", follow, { passive: true });
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, []);

  return (
    <div ref={root} className="stage">
      {children}
    </div>
  );
}
