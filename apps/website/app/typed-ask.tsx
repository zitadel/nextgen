"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { Placement } from "./analytics";
import { CopyButton } from "./copy-button";
import { prefersReducedMotion } from "./showcase/motion";

// A key a little faster than a person types, how long an ask stays, and how
// long the first one, the sign-in, stays before the others.
const KEY_MS = 38;
const HOLD_MS = 2600;
const FIRST_HOLD_MS = 4200;

/** Whether `ref` is on screen now (its tab shown, the hero in view), updated as that changes. */
function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver((entries) =>
      setOnScreen(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/**
 * The start window's ask at your agent's prompt (›), typing through `asks`:
 * the first stands, holds a little longer, and the next types out over it,
 * only while it is on screen. Every ask is stacked in one place, the longest
 * holding the line's height, so the window never changes height while one
 * types. Before the page hydrates, without script and for reduced motion,
 * the first simply stands. Its copy button copies the ask shown and reports
 * `copied_command` as `ask` (analytics.ts).
 */
export function TypedAsk({ asks, placement }: { asks: readonly string[]; placement: Placement }) {
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(asks[0]?.length ?? 0);
  const [motion, setMotion] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root);
  const shown = asks[active] ?? "";

  useEffect(() => {
    if (!prefersReducedMotion()) {
      setMotion(true);
    }
  }, []);

  useEffect(() => {
    if (!motion || !onScreen || asks.length < 2) {
      return;
    }
    const tick =
      typed < shown.length
        ? setTimeout(() => setTyped(typed + 1), KEY_MS)
        : setTimeout(
            () => {
              setActive((active + 1) % asks.length);
              setTyped(0);
            },
            active === 0 ? FIRST_HOLD_MS : HOLD_MS,
          );
    return () => clearTimeout(tick);
  }, [motion, onScreen, asks.length, active, typed, shown.length]);

  return (
    <div
      ref={root}
      className="group -mx-2 flex items-start gap-2 rounded-md px-2 text-text-primary transition-colors hover:bg-tint/[0.04]"
    >
      {/* The prompt and the ask set as a command line's `$ ` and command. */}
      <span className="flex flex-1">
        <span aria-hidden="true" className="w-[2ch] shrink-0 select-none text-text-muted">
          ›
        </span>
        {/* Screen readers get the ask the step is about; the others are the
            window's examples, typed for the eye. */}
        <span className="sr-only">{asks[0]}</span>
        <span aria-hidden="true" className="grid flex-1">
          {asks.map((ask, index) => (
            <span key={ask} className={`[grid-area:1/1] ${index === active ? "" : "invisible"}`}>
              {index === active ? (
                <>
                  {ask.slice(0, typed)}
                  {motion && typed < ask.length && <span className="caret ml-px" />}
                  <span className="invisible">{ask.slice(typed)}</span>
                </>
              ) : (
                ask
              )}
            </span>
          ))}
        </span>
      </span>
      {/* Centered on the first line of the ask, as a command line's is. */}
      <span className="my-[calc((1lh_-_1.75rem)/2)] flex shrink-0 items-center gap-2">
        <CopyButton text={shown} label={shown} event={{ snippet: "ask", placement }} />
      </span>
    </div>
  );
}
