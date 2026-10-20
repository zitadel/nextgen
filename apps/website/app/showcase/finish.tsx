import type { CSSProperties } from "react";
import { CallToAction } from "../cta";
import { RAIL, Sentences, stepColor } from "./step";

// A line's place in the finish's rise, one after another.
const order = (index: number) => ({ "--i": index }) as CSSProperties;

/**
 * The end of the steps: the login is live, and the way on is the quickstart.
 * Its dot on the spine is a check in the stepper's last color, green; as the
 * spine's fill reaches it (spine.tsx sets data-reached), the check pops with
 * a ring, the card lights in green from above, and its lines rise in one
 * after another (globals.css, .finish-*). Without script, or for reduced
 * motion, it simply stands there.
 */
export function Finish({ index, count }: { index: number; count: number }) {
  return (
    <li
      data-step
      data-finish
      style={stepColor(index, count)}
      className={`group/step relative grid grid-cols-1 ${RAIL}`}
    >
      {/* The spine's last dot, level with the card's first line: the check in
          the rail, and on a phone a dot in the gutter. */}
      <span
        aria-hidden="true"
        data-dot
        className="step-dot finish-dot absolute top-[2.75rem] -left-4 size-2 md:hidden"
      />
      <div aria-hidden="true" className="relative hidden justify-center pt-[3.125rem] md:flex">
        <span
          data-dot
          data-glow
          className="step-dot finish-dot relative z-10 flex size-7 items-center justify-center"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5">
            <path
              d="M3.5 8.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <div className="finish-card relative isolate overflow-hidden rounded-2xl border bg-window px-5 py-10 text-center shadow-window md:px-10 md:py-14">
        <div aria-hidden="true" className="finish-glow absolute inset-0 -z-10" />
        <p className="finish-reveal font-mono text-(--step) text-xs leading-4" style={order(0)}>
          That's the whole loop
        </p>
        <h2
          className="finish-reveal mx-auto mt-4 max-w-xl text-balance text-3xl leading-tight md:text-5xl"
          style={order(1)}
        >
          <span className="display-title">Get started with Zitadel now.</span>
        </h2>
        <p
          className="finish-reveal mx-auto mt-4 max-w-lg text-balance text-lg text-text-secondary leading-7"
          style={order(2)}
        >
          <Sentences text="From the first command to a login that is yours in a minute. The quickstart walks you through it." />
        </p>
        <div className="finish-reveal" style={order(3)}>
          <CallToAction className="mt-7" />
        </div>
      </div>
    </li>
  );
}
