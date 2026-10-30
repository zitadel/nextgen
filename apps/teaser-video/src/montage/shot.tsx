import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AbsoluteFill, continueRender, delayRender, interpolate, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { fontsLoaded, LoginSurface } from "../login-surface";
import { HEIGHT, WIDTH } from "../timeline";

// One shot of the montage: what it shows, in a brand, centred on the frame.
// A whole screen is scaled to fill most of the frame's height; a close-up
// gives its own scale. The camera pushes in a little over the shot, so even a
// still screen moves with the cut. Every frame waits until the atoms have
// rendered what it set.

/** A screen never grows past this, however short it is. */
const MOST = 2.2;
/** The share of the frame a screen may fill. */
const ROOM = 0.86;

export function Shot({
  brand,
  length,
  scale,
  push = 0.04,
  children,
}: {
  brand: Brand;
  /** The shot's length in frames, over which the camera pushes in. */
  length: number;
  /** A fixed scale for a close-up; a screen without one is fitted. */
  scale?: number;
  /** How much larger the shot ends than it starts. */
  push?: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const content = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number>();

  useLayoutEffect(() => {
    const root = content.current;
    if (!root) {
      return;
    }
    const handle = delayRender("Rendering the shot's atoms");
    const atoms = [...root.querySelectorAll("*")].filter(
      (element): element is HTMLElement & { updateComplete: Promise<unknown> } =>
        "updateComplete" in element,
    );
    Promise.all([fontsLoaded, ...atoms.map((atom) => atom.updateComplete)]).then(() => {
      if (scale === undefined && fit === undefined) {
        flushSync(() =>
          setFit(
            Math.min(MOST, (ROOM * HEIGHT) / root.offsetHeight, (ROOM * WIDTH) / root.offsetWidth),
          ),
        );
      }
      continueRender(handle);
    });
  }, [frame, scale, fit]);

  const base = scale ?? fit ?? 1;
  const zoom = base * interpolate(frame, [0, length], [1, 1 + push]);
  return (
    <LoginSurface theme={brand.theme} brand={brandProperties(brand)}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div ref={content} style={{ transform: `scale(${zoom})` }}>
          {children}
        </div>
      </AbsoluteFill>
    </LoginSurface>
  );
}
