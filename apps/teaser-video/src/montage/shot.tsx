import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AbsoluteFill, continueRender, delayRender, interpolate, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { fontsLoaded, LoginSurface } from "../login-surface";
import { HEIGHT, WIDTH } from "../timeline";

// One shot of the montage: what it shows, in a brand. A screen or a part of
// one is centred on the frame: a whole screen scaled to fill most of the
// frame's height, a close-up at its own scale. A scene lays out the whole
// frame itself. Either way the camera pushes in a little over the shot, so
// even a still frame moves with the cut, and every frame waits until the atoms
// have rendered what it set.

/** A screen never grows past this, however short it is. */
const MOST = 2.2;
/** The share of the frame a screen may fill. */
const ROOM = 0.86;

/**
 * Holds each frame until every atom under `root` has rendered, then calls
 * `rendered` with it, still inside the hold.
 */
export function useAtomsRendered(
  root: RefObject<HTMLElement | null>,
  frame: number,
  rendered?: (root: HTMLElement) => void,
) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const handle = delayRender("Rendering the shot's atoms");
    const atoms = [...element.querySelectorAll("*")].filter(
      (node): node is HTMLElement & { updateComplete: Promise<unknown> } =>
        "updateComplete" in node,
    );
    Promise.all([fontsLoaded, ...atoms.map((atom) => atom.updateComplete)]).then(() => {
      rendered?.(element);
      continueRender(handle);
    });
  }, [frame]);
}

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

  useAtomsRendered(content, frame, (root) => {
    if (scale === undefined && fit === undefined) {
      flushSync(() =>
        setFit(
          Math.min(MOST, (ROOM * HEIGHT) / root.offsetHeight, (ROOM * WIDTH) / root.offsetWidth),
        ),
      );
    }
  });

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

/** A shot whose content lays out the whole frame, 1920 by 1080, in a brand. */
export function Scene({
  brand,
  length,
  push = 0.03,
  blurOut = 0,
  children,
}: {
  brand: Brand;
  length: number;
  push?: number;
  /** Over this many last frames, the scene blurs away into black. */
  blurOut?: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const content = useRef<HTMLDivElement>(null);
  useAtomsRendered(content, frame);
  const zoom = interpolate(frame, [0, length], [1, 1 + push]);
  const gone = blurOut
    ? interpolate(frame, [length - blurOut, length], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  return (
    <LoginSurface theme={brand.theme} brand={brandProperties(brand)}>
      <div
        ref={content}
        style={{
          position: "absolute",
          width: WIDTH,
          height: HEIGHT,
          transform: `scale(${zoom})`,
          filter: gone ? `blur(${gone * 28}px)` : undefined,
        }}
      >
        {children}
      </div>
      {/* Into black, whatever the scene's own ground, light or dark. */}
      {gone > 0 && <AbsoluteFill style={{ background: "#000", opacity: gone }} />}
    </LoginSurface>
  );
}
