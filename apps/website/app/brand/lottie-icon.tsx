"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../showcase/motion";

/** zitadel/new-website's three animated icons (public/animations). */
export type IconName = "bars" | "circle" | "triangle";

// Each icon's animation, fetched with the player once the page has painted.
const ANIMATIONS: Record<IconName, () => Promise<{ default: unknown }>> = {
  bars: () => import("./Icon_Bars.json"),
  circle: () => import("./Icon_Circle.json"),
  triangle: () => import("./Icon_Triangle.json"),
};

/**
 * One of the brand's animated icons (zitadel/new-website's LottieIcon), on
 * lottie-web's light player: it draws SVG and runs no expressions, so it
 * needs no 'unsafe-eval' under the pages' policy (csp-adapter.mjs). Player
 * and animation load when the browser is idle after the first paint, into a
 * box that already holds their place; for reduced motion the first frame
 * stands still.
 */
export function LottieIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let canceled = false;
    let animation: { destroy: () => void } | undefined;

    const load = async () => {
      const [{ default: lottie }, { default: animationData }] = await Promise.all([
        import("lottie-web/build/player/lottie_light"),
        ANIMATIONS[name](),
      ]);
      const container = box.current;
      if (canceled || !container) {
        return;
      }
      const still = prefersReducedMotion();
      const loaded = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: !still,
        autoplay: !still,
        animationData,
      });
      if (still) {
        loaded.goToAndStop(0, true);
      }
      animation = loaded;
    };

    const start = () => {
      load().catch(() => {});
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(start, { timeout: 2000 })
      : window.setTimeout(start, 300);

    return () => {
      canceled = true;
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle);
      }
      animation?.destroy();
    };
  }, [name]);

  return <span ref={box} aria-hidden="true" className={`inline-block ${className}`} />;
}
