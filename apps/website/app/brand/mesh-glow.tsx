import type { CSSProperties } from "react";

/**
 * Three soft blots of lilac, purple and pink behind a card's surface
 * (.mesh-glow), centred near `x`, `y`: the look of zitadel/new-website's
 * ManagedMeshGradient as CSS, with no WebGL shader to load. Background only:
 * these hues never mark a control or a state.
 */
export function MeshGlow({ x = "80%", y = "20%" }: { x?: string; y?: string }) {
  return (
    <div
      aria-hidden="true"
      className="mesh-glow"
      style={{ "--glow-x": x, "--glow-y": y } as CSSProperties}
    />
  );
}
