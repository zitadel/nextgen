/** The brand's signature shapes, small: slats, a sphere, a rosette, a blade fan. */
export type Shape = "slats" | "sphere" | "rosette" | "blade";

/** One shape in a 32 × 32 box, lit in orange and falling off into the dark. */
function ShapeMark({ shape }: { shape: Shape }) {
  const id = `divider-${shape}`;
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0">
      <defs>
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shape-from" />
          <stop offset="1" className="shape-to" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-ball`} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" className="shape-from" />
          <stop offset="0.6" className="shape-mid" />
          <stop offset="1" className="shape-to" stopOpacity="0" />
        </radialGradient>
      </defs>
      {shape === "slats" &&
        [4, 11, 18, 25].map((x, index) => (
          <rect
            key={x}
            x={x}
            y={10 - index * 2.5}
            width="4"
            height={12 + index * 5}
            rx="1.5"
            fill={`url(#${id}-line)`}
          />
        ))}
      {shape === "sphere" && <circle cx="16" cy="16" r="13" fill={`url(#${id}-ball)`} />}
      {shape === "rosette" &&
        [0, 45, 90, 135].map((angle) => (
          <ellipse
            key={angle}
            cx="16"
            cy="16"
            rx="5"
            ry="14"
            transform={`rotate(${angle} 16 16)`}
            fill={`url(#${id}-line)`}
            opacity="0.7"
          />
        ))}
      {shape === "blade" &&
        ["2,4 12,9 12,23 2,28", "13,2 19,8 19,24 13,30", "20,4 30,9 30,23 20,28"].map((points) => (
          <polygon key={points} points={points} fill={`url(#${id}-line)`} />
        ))}
    </svg>
  );
}

/**
 * The brand's section divider: the section's number in orange, its tag in
 * the display face's capitals, a hairline out to the edge and a shape at
 * the end. It names the section the heading under it then states, so
 * screen readers skip it.
 */
export function Divider({ number, tag, shape }: { number: string; tag: string; shape: Shape }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-4 font-heading text-sm uppercase leading-5 tracking-[0.08em]"
    >
      <span className="text-brand">{number}</span>
      <span className="text-text-primary">{tag}</span>
      <span className="h-px flex-1 bg-linear-to-r from-border-secondary to-transparent" />
      <ShapeMark shape={shape} />
    </div>
  );
}
