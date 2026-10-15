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

// The three dots of a window's title bar.
export function WindowDots() {
  return (
    <span aria-hidden="true" className="flex gap-1.5">
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
      <span className="size-2.5 rounded-full bg-surface-black-secondary" />
    </span>
  );
}
