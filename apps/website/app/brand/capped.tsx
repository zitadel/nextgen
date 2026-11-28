"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A window no taller than the front page's default one (--window-cap):
 * cut there, with the window's surface rising over the cut and a link to
 * the page that shows it whole. Whether it is cut is measured, so a short
 * window keeps its own foot; the fade and the link lie over the window, so
 * nothing moves when they come.
 */
export function Capped({ href, children }: { href: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) {
      observer.observe(child);
    }
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative">
      <div ref={box} className="max-h-(--window-cap) overflow-hidden rounded-xl">
        {children}
      </div>
      {cut && (
        <div className="window-fade absolute inset-x-0 bottom-0 flex h-28 items-end justify-center rounded-b-xl border-window-border border-x border-b pb-4">
          <a
            href={href}
            className="group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-semibold text-sm text-text-primary transition-colors hover:bg-tint/[0.06]"
          >
            See the full example
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="size-4 transition-transform group-hover:translate-x-0.5"
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}
