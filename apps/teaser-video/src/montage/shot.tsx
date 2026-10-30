import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { handheld, push } from "../camera";
import { fontsLoaded, LoginSurface } from "../login-surface";
import { HEIGHT, WIDTH } from "../timeline";

// What every montage shot shares: the wait that holds each frame until the
// atoms have rendered what it set, and the scene, a shot whose content lays
// out the whole frame in a brand, under a camera that pushes in and drifts
// as if held.

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

/** A shot whose content lays out the whole frame, 1920 by 1080, in a brand. */
export function Scene({
  brand,
  length,
  seed,
  pushBy = 0.03,
  blurOut = 0,
  children,
}: {
  brand: Brand;
  length: number;
  /** Which shot this is, so its camera drifts its own way. */
  seed: number;
  pushBy?: number;
  /** Over this many last frames, the scene blurs away into black. */
  blurOut?: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const content = useRef<HTMLDivElement>(null);
  useAtomsRendered(content, frame);
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
          transform: `${handheld(frame, seed)} scale(${push(frame, length, pushBy)})`,
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
