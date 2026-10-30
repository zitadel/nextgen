import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { HEIGHT, WIDTH } from "./timeline";

// What every frame passes through last, so the video reads as footage rather
// than a render: a gentle grade, a vignette, and a fine grain that changes
// every frame, which also breaks up the banding a smooth gradient would show.

export function FilmLook({ children }: { children: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ filter: "contrast(1.04) saturate(0.95)" }}>{children}</AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 58%, rgb(0 0 0 / 0.3))",
        }}
      />
      <svg
        width={WIDTH}
        height={HEIGHT}
        role="presentation"
        style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: 0.12 }}
      >
        <filter id="film-grain">
          {/* A new pattern each frame, from a fixed list, so every render grains alike. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 31} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={WIDTH} height={HEIGHT} filter="url(#film-grain)" />
      </svg>
    </AbsoluteFill>
  );
}
