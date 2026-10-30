import { type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { interpolate, useCurrentFrame } from "remotion";

import { type Brand, brandProperties } from "../brands";
import { LoginSurface } from "../login-surface";
import { HEIGHT, WIDTH } from "../timeline";
import { useAtomsRendered } from "./shot";

// A part of a screen, never on its own: the whole screen in its brand, the
// camera close on the element marked `data-focus`, so what is around it, the
// field above, the button below, stays in the frame, cut off by its edges as
// the cold open's email is.

type Point = { x: number; y: number };

export function FocusShot({
  brand,
  length,
  scale,
  anchor = { x: 0.5, y: 0.5 },
  push = 0.06,
  render,
}: {
  brand: Brand;
  length: number;
  /** How much larger than on a page the screen is shown. */
  scale: number;
  /** Where on the frame the focused element sits, as shares of its width and height. */
  anchor?: Point;
  /** How much closer the camera ends than it starts. */
  push?: number;
  /** The screen `frame` frames in, one element of it marked `data-focus`. */
  render: (frame: number) => ReactNode;
}) {
  const frame = useCurrentFrame();
  const stage = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Point>();

  useAtomsRendered(stage, frame, (root) => {
    if (focus) {
      return;
    }
    const target = root.querySelector("[data-focus]");
    if (!target) {
      throw new Error("A focus shot's screen marks no element with data-focus");
    }
    const origin = root.getBoundingClientRect();
    const factor = origin.width / root.offsetWidth;
    const box = target.getBoundingClientRect();
    flushSync(() =>
      setFocus({
        x: (box.left + box.width / 2 - origin.left) / factor,
        y: (box.top + box.height / 2 - origin.top) / factor,
      }),
    );
  });

  const zoom = scale * interpolate(frame, [0, length], [1, 1 + push]);
  const at = focus ?? { x: WIDTH / 2, y: HEIGHT / 2 };
  return (
    <LoginSurface theme={brand.theme} brand={brandProperties(brand)}>
      <div
        ref={stage}
        style={{
          position: "absolute",
          width: WIDTH,
          height: HEIGHT,
          transformOrigin: "0 0",
          transform: `translate(${anchor.x * WIDTH}px, ${anchor.y * HEIGHT}px) scale(${zoom}) translate(${-at.x}px, ${-at.y}px)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {render(frame)}
      </div>
    </LoginSurface>
  );
}
