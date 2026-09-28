import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The Figma Lucide stroke: the design system's Lucide masters (Boxes, Box,
 * ChevronsUpDown, PanelLeft, Workflow, Users, …) draw a ~0.6px line with round
 * caps and joins. lucide-react's default is 2 in a 24-unit box, which reads far
 * heavier.
 *
 * The line stays 0.6px whatever size the icon renders — the way Figma keeps a
 * vector's stroke width when an icon instance is resized from its 24px master
 * to 16px — through `vector-effect: non-scaling-stroke` on the icon's shapes.
 * (lucide-react 1.20's `absoluteStrokeWidth` only corrects icons given a `size`
 * prop; the sidebar sizes its icons with CSS, which it would leave at 0.4px.)
 * Round caps and joins are already Lucide's own.
 *
 * One provider, not per-icon props: wrap a region and every Lucide icon inside
 * it (including menus portalled out of it) picks up the stroke. An icon that
 * sets `strokeWidth` itself keeps its own value, so resource-table row icons
 * (stroke 1.5) are unaffected.
 */
export const FIGMA_ICON_STROKE = 0.6;

export function FigmaIcons({ children }: { children: ReactNode }) {
  return (
    <LucideProvider
      strokeWidth={FIGMA_ICON_STROKE}
      className="[&_*]:[vector-effect:non-scaling-stroke]"
    >
      {children}
    </LucideProvider>
  );
}
