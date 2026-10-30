import { Easing, interpolate } from "remotion";

import { seconds } from "./timeline";

// A mouse pointer that moves in, settles on what it is about to press and
// clicks: so a button presses and a box ticks because someone did it, not by
// itself. It is drawn in the screen's own pixels, so it scales with the
// camera like everything else on the screen.

/** When the pointer clicks, in seconds into the shot; what it clicks changes state then. */
export const CLICK = 0.12;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function Pointer({ x, y, frame }: { x: number; y: number; frame: number }) {
  // From below and to the right, on a slight curve, arriving just before the click.
  const travel = interpolate(frame, [0, seconds(CLICK - 0.03)], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const left = x + (1 - travel) * 70 + Math.sin(travel * Math.PI) * 8;
  const top = y + (1 - travel) * 55;
  const pressed = frame >= seconds(CLICK) && frame < seconds(CLICK + 0.1);
  return (
    <svg
      viewBox="0 0 20 28"
      width={20}
      height={28}
      role="presentation"
      style={{
        position: "absolute",
        left,
        top,
        transformOrigin: "0 0",
        transform: `scale(${pressed ? 0.86 : 1})`,
        filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.35))",
        pointerEvents: "none",
      }}
    >
      <path
        d="M1 1 L1 22 L6.5 17 L10 25.5 L13.5 24 L10 15.5 L17 15.5 Z"
        fill="#111"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
