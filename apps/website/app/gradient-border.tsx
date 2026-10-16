import type { ReactNode } from "react";

// The website's card edge (zitadel/new-website's GradientBorderBox): a
// gradient hairline from two backgrounds, one clipped to the padding box and
// one to the border box, without the CSS mask iOS Safari pays for under
// scrolling or animating content.
export function GradientBorder({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-transparent ${className}`}
      style={{
        background:
          "linear-gradient(#0f0f11, #0f0f11) padding-box, linear-gradient(274.7deg, rgba(130, 130, 156, 0.6) 0.83%, rgba(37, 37, 40, 0.6) 94.25%, rgba(130, 130, 156, 0.6) 98.84%) border-box",
      }}
    >
      {children}
    </div>
  );
}

// A window's title bar in the showcase, one height for every window there, so
// two windows side by side start their content on one line. Each adds its gaps
// and padding. The hero's terminal keeps its own: the hero's height is
// reserved to the pixel (.stage in globals.css).
export const TITLE_BAR = "flex h-12 items-center border-border-secondary border-b";

// The three dots of a window's title bar.
export function WindowDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`flex gap-1.5 ${className}`}>
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
    </span>
  );
}
