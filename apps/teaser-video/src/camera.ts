import { Easing, interpolate } from "remotion";

import { FPS } from "./timeline";

// How the montage's camera moves, so it reads as held rather than computed:
// a push that eases in and settles as an operator's would, and a drift of a
// few pixels and a fraction of a degree, on slow waves that differ per shot.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** How much larger than at its start a shot is `frame` frames in, pushing `amount` over `length`. */
export const push = (frame: number, length: number, amount: number) =>
  1 +
  amount * interpolate(frame, [0, length], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });

/** The drift of a hand-held camera `frame` frames into the shot `seed`, as a CSS transform. */
export function handheld(frame: number, seed: number): string {
  const time = frame / FPS + seed * 3.7;
  const x = 5 * Math.sin(time * 0.9) + 2.5 * Math.sin(time * 2.3 + 1.3);
  const y = 4 * Math.sin(time * 0.7 + 2.1) + 2 * Math.sin(time * 1.9 + 0.4);
  const turn = 0.12 * Math.sin(time * 0.5 + 0.8);
  return `translate(${x}px, ${y}px) rotate(${turn}deg)`;
}
