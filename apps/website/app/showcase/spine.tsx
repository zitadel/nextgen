"use client";

import { useEffect, useRef } from "react";

// Where on the screen the visitor reads: a step counts as reached once its
// dot passes this share of the viewport's height.
const READING_LINE = 0.6;

/**
 * The line through the steps' dots (step.tsx, finish.tsx), from the first
 * dot's centre to the last's, in the rail beside the steps from a tablet up
 * and in the page's gutter on a phone, where it ends in the finish's card: a quiet track, and
 * over it the fill, drawn down to the reading line as the visitor scrolls.
 * The fill's gradient spans the whole track, Zitadel's orange to the
 * finish's green, so each stretch keeps its colour as the fill grows, and
 * meets each dot in that dot's own colour (stepColor).
 *
 * Each step whose dot the fill has passed gets data-reached, which lights
 * it; at the bottom of the page every step counts as reached, so a tall
 * screen still gets to the finish. The list gets data-armed, which lets the
 * finish hold its lines back until then (globals.css). Written to the DOM
 * straight from the scroll, and from the list's resizes, once a frame, so
 * scrolling never re-renders the steps.
 */
export function Spine() {
  const root = useRef<HTMLLIElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const list = root.current?.parentElement;
    if (!list) {
      return;
    }
    list.toggleAttribute("data-armed", true);
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = list.getBoundingClientRect().top;
      const line = window.innerHeight * READING_LINE;
      const bottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const centres: number[] = [];
      for (const step of list.querySelectorAll<HTMLElement>("[data-step]")) {
        // A step has a dot for the rail and one for a phone's gutter; the
        // one the screen shows counts.
        const dot = [...step.querySelectorAll<HTMLElement>("[data-dot]")]
          .map((element) => element.getBoundingClientRect())
          .find((rect) => rect.height > 0);
        if (!dot) {
          continue;
        }
        const centre = dot.top + dot.height / 2 - top;
        step.toggleAttribute("data-reached", bottom || top + centre <= line);
        centres.push(centre);
      }
      const start = centres[0] ?? 0;
      const length = (centres.at(-1) ?? 0) - start;
      const reach = bottom ? length : Math.min(Math.max(line - top - start, 0), length);
      for (const element of [track.current, fill.current]) {
        element?.style.setProperty("top", `${start}px`);
      }
      track.current?.style.setProperty("height", `${length}px`);
      if (fill.current) {
        fill.current.style.height = `${reach}px`;
        fill.current.style.backgroundSize = `100% ${length}px`;
        fill.current.toggleAttribute("data-complete", reach >= length);
      }
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The steps grow as their login previews load, with no scroll to say so.
    const resize = new ResizeObserver(schedule);
    resize.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      list.removeAttribute("data-armed");
    };
  }, []);

  // Until measured, nothing shows; the fill fades at its leading end until it
  // arrives at the finish.
  return (
    <li
      ref={root}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 -left-6 flex w-6 justify-center md:left-0 md:w-10"
    >
      <span ref={track} className="absolute h-0 w-px bg-border-primary" />
      <span
        ref={fill}
        className="absolute h-0 w-px bg-[linear-gradient(in_oklch_to_bottom,var(--color-step-start),var(--color-step-end))] bg-no-repeat [mask-image:linear-gradient(to_bottom,#000_calc(100%-5rem),transparent)] data-complete:[mask-image:none]"
      />
    </li>
  );
}
