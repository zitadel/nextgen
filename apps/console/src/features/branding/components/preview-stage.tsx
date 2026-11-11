import { type CSSProperties, type ReactNode, useState } from "react";

/** The colours the element paints with, as its own `--zl-*` properties resolve them. */
export type Ground = { background: string; foreground: string };

/**
 * The ground the preview sits on, as an embedding page would draw it: the
 * element's own background with a faint dot grid of its foreground, like the
 * website's preview. It follows the side the element actually paints — the
 * pinned one, or the branding's `theme.mode`, which `auto` resolves from the
 * visitor's OS — and any brand colours, so a light widget never sits on the
 * console's dark card or the other way round.
 *
 * The colours are read from the element (`getComputedStyle`) whenever it
 * changes side or style, or serves a step, since the revision arrives with
 * the flow. Until then the stage keeps its card colour.
 */
export function PreviewStage({
  className,
  children,
}: {
  className?: string;
  children: (onGround: (ground: Ground) => void) => ReactNode;
}) {
  const [ground, setGround] = useState<Ground>();
  const style: CSSProperties | undefined = ground && {
    backgroundColor: ground.background,
    backgroundImage: `radial-gradient(color-mix(in srgb, ${ground.foreground} 9%, transparent) 1px, transparent 1px)`,
    backgroundSize: "1rem 1rem",
    backgroundPosition: "center",
  };
  return (
    <div className={className} style={style}>
      {children(setGround)}
    </div>
  );
}
