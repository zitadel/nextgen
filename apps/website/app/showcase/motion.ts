"use client";

import { type RefObject, useEffect, useState } from "react";

/** Whether the visitor asked for less motion; read on the client only. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Turns true once `threshold` of `ref` has been on screen (or within
 * `rootMargin` of it), and stays true: the moment a step's replay starts, or
 * a preview's atoms load. An observer also reports the first pixel coming
 * into view, so the share is checked, not only the crossing.
 */
export function useSeen(
  ref: RefObject<Element | null>,
  { threshold = 0, rootMargin }: { threshold?: number; rootMargin?: string } = {},
): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= threshold)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold, rootMargin]);

  return seen;
}
