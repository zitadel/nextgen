import { type ComponentType, type SVGProps, useEffect, useId, useRef, useState } from "react";

/**
 * Icon component shape shared by the sidebar. Lucide icons satisfy this, and
 * the custom Zitadel logo mark below matches it so they drop into the nav
 * interchangeably.
 */
export type NavIcon = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
}>;

type IconProps = {
  size?: number | string;
  className?: string;
} & SVGProps<SVGSVGElement>;

/** Zitadel logo mark used at the top of the sidebar (fills with currentColor). */
export function ZitadelMark({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22.31 23.78"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>Zitadel</title>
      <path d="M3.22363 6.71172C3.24542 6.49676 3.42256 6.27254 3.66297 6.15562L14.1415 0.0777808C14.5209 -0.106733 14.8761 0.052579 14.8418 0.391801V7.12373C14.82 7.33869 14.6428 7.56292 14.4024 7.67984L3.92389 13.6347C3.54451 13.8193 3.18925 13.6599 3.22363 13.3207V6.71172Z" />
      <path d="M22.0459 8.26746C22.2211 8.39381 22.3268 8.65932 22.3078 8.92598V20.8737C22.2779 21.2945 21.9623 21.5225 21.6857 21.3231L15.8955 18.0136C15.7202 17.8873 15.6146 17.6218 15.6335 17.3551V5.23555C15.6634 4.81475 15.979 4.58675 16.2556 4.78614L22.0459 8.26746Z" />
      <path d="M11.6052 23.7338C11.4081 23.8224 11.1254 23.7811 10.9039 23.6314L0.288726 17.5315C-0.0607637 17.2953 -0.10042 16.9079 0.210559 16.7681L5.92162 13.4366C6.11869 13.348 6.40145 13.3893 6.62292 13.539L17.161 19.7247C17.5105 19.9609 17.5562 20.3201 17.2392 20.4881L11.6052 23.7338Z" />
    </svg>
  );
}

/**
 * Whether the pointer was on a logo when it unmounted. Both shells draw the
 * logo in the same spot, so following it from a project's screens home swaps
 * one logo for another under a cursor that has not moved, and the new logo's
 * `pointerenter` is that hover going on, not a new one to play for. Moving
 * the pointer anywhere else ends the hand-over, so the next hover plays.
 */
let handedOver = false;

function handOver() {
  handedOver = true;
  const end = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest("a")?.querySelector(".logo")) {
      return;
    }
    handedOver = false;
    document.removeEventListener("pointermove", end);
  };
  document.addEventListener("pointermove", end);
}

/**
 * Full Zitadel logo lockup — mark plus wordmark — in the extended sidebar
 * header, animated as on the website's nav (`apps/website/app/logo.tsx`, kept
 * in step with it): the mark turns once and the letters roll in on a hover of
 * the link around it. Unlike the website it never plays by itself: it sits in
 * chrome people look at all day. Drawn from the website's
 * Lottie as plain SVG, its motion in `styles.css` (`.logo`), so there is no
 * player library and nothing to load before it shows. Reduced motion keeps it
 * still.
 *
 * Every path is `currentColor`, the mark's three facets disjoint paths, so the
 * lockup flips with `data-theme` for free.
 *
 * `ZitadelMark` above stays for the surfaces that want the mark alone (the login
 * screen, and the collapsed rail where there is no room for the wordmark).
 */
export function ZitadelLogo({ className }: { className?: string }) {
  const root = useRef<SVGSVGElement>(null);
  const [playing, setPlaying] = useState(false);
  // Prefixes the clip path's and the letters' ids; `useId`'s colons are not
  // valid in a `url(#…)` reference.
  const prefix = `logo${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const target = root.current?.closest("a") ?? root.current;
    if (!target) return;
    let inside = false;
    const enter = () => {
      inside = true;
      // The hover that was on the logo this one replaced goes on here.
      if (handedOver) handedOver = false;
      else setPlaying(true);
    };
    const leave = () => {
      inside = false;
    };
    target.addEventListener("pointerenter", enter);
    target.addEventListener("pointerleave", leave);
    return () => {
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
      if (inside) handOver();
    };
  }, []);

  return (
    <svg
      ref={root}
      viewBox="0 0 495 122"
      fill="currentColor"
      // The link around it names it ("Home").
      aria-hidden="true"
      className={`logo ${className ?? ""}`}
      data-playing={playing || undefined}
      // The last letter lands last: the play is over, the next hover replays it.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget.querySelector(".logo-letter:last-child")) {
          setPlaying(false);
        }
      }}
    >
      <title>Zitadel</title>
      <defs>
        <clipPath id={`${prefix}-window`}>
          <rect x="129.2" y="16.99" width="398.88" height="88.48" />
        </clipPath>
      </defs>
      <path className="logo-icon" d={LOGO_ICON} />
      <g clipPath={`url(#${prefix}-window)`}>
        {LOGO_LETTERS.map(({ id, d }, index) => (
          // One after another, a sixth of a second apart: 5 of the Lottie's 30
          // frames a second.
          <g key={id} className="logo-letter" style={{ animationDelay: `${index / 6}s` }}>
            <path id={`${prefix}-${id}`} d={d} />
            <use href={`#${prefix}-${id}`} y={-100} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** The mark, at rest; it turns about (63, 63). */
const LOGO_ICON =
  "M23.92 34.61C22.83 35.14 22.02 36.17 21.92 37.14L21.92 67.21C21.76 68.76 23.38 69.49 25.11 68.64L72.79 41.55C73.88 41.02 74.68 40 74.78 39.02L74.78 8.39C74.94 6.84 73.32 6.12 71.6 6.96L23.92 34.61ZM108.75 47.22C108.84 46.01 108.36 44.8 107.56 44.22L81.21 28.38C79.96 27.48 78.52 28.51 78.38 30.43L78.38 85.57C78.3 86.79 78.78 87.99 79.58 88.57L105.92 103.63C107.18 104.53 108.62 103.5 108.75 101.58L108.75 47.22ZM56.86 114.13C57.88 114.81 59.16 115 60.06 114.59L85.69 99.82C87.13 99.06 86.93 97.43 85.34 96.35L37.39 68.21C36.38 67.53 35.09 67.34 34.2 67.74L8.21 82.9C6.8 83.54 6.98 85.3 8.57 86.38L56.86 114.13Z";

/**
 * The letters, at rest. Each rolls down out of the window below as a copy of
 * it, 100 units above, rolls into place.
 */
const LOGO_LETTERS = [
  {
    id: "z",
    d: "M149.23 91.12L149.23 100.44L201.36 100.44L201.36 90.1L163.08 90.1L201.02 30.25L201.02 20.93L149.68 20.93L149.68 31.16L187.05 31.16L149.23 91.12Z",
  },
  {
    id: "i",
    d: "M213.95 31.95C215.54 33.46 217.43 34.22 219.63 34.22C221.9 34.22 223.79 33.46 225.31 31.95C226.9 30.36 227.7 28.43 227.7 26.16C227.7 23.96 226.9 22.1 225.31 20.59C223.79 19.08 221.9 18.32 219.63 18.32C217.43 18.32 215.54 19.08 213.95 20.59C212.44 22.1 211.68 23.96 211.68 26.16C211.68 28.43 212.44 30.36 213.95 31.95ZM213.61 44.1L213.61 100.44L225.65 100.44L225.65 44.1L213.61 44.1Z",
  },
  {
    id: "t",
    d: "M248.64 96.35C251.67 99.07 255.98 100.44 261.58 100.44L270.45 100.44L270.45 90.21L264.08 90.21C261.36 90.21 259.35 89.72 258.07 88.74C256.78 87.75 256.14 85.82 256.14 82.95L256.14 54.21L270.45 54.21L270.45 44.1L256.14 44.1L256.14 30.47L244.09 30.47L244.09 44.1L235.58 44.1L235.58 54.21L244.09 54.21L244.09 82.95C244.09 89.16 245.61 93.62 248.64 96.35Z",
  },
  {
    id: "a",
    d: "M289.32 99.87C292.35 101.16 295.68 101.8 299.31 101.8C303.78 101.8 307.75 100.74 311.24 98.62C314.72 96.5 317.37 93.92 319.18 90.89C320.02 93.09 321.15 94.91 322.59 96.35C324.03 97.71 325.85 98.73 328.05 99.41C330.32 100.1 332.97 100.44 336 100.44L336 90.1C333.73 89.95 332.14 89.38 331.23 88.4C330.39 87.34 329.94 85.71 329.86 83.51L329.86 66.25C329.86 61.71 328.95 57.65 327.14 54.09C325.39 50.54 322.71 47.78 319.07 45.81C315.52 43.76 311.01 42.74 305.56 42.74C301.39 42.74 297.46 43.5 293.75 45.01C290.03 46.53 286.97 48.72 284.54 51.6C282.2 54.47 280.83 57.96 280.45 62.05L292.61 62.05C293.22 58.87 294.69 56.56 297.04 55.12C299.46 53.6 302.26 52.84 305.44 52.84C307.87 52.84 309.99 53.34 311.8 54.32C313.62 55.23 315.06 56.71 316.12 58.75C317.18 60.72 317.71 63.33 317.71 66.59L303.4 66.59C299.01 66.59 294.96 67.23 291.25 68.52C287.61 69.73 284.7 71.66 282.5 74.31C280.38 76.89 279.32 80.33 279.32 84.65C279.32 88.29 280.23 91.39 282.04 93.96C283.86 96.54 286.29 98.5 289.32 99.87ZM310.33 89.65C307.98 91.16 305.25 91.92 302.15 91.92C299.27 91.92 296.81 91.27 294.77 89.99C292.72 88.63 291.7 86.51 291.7 83.63C291.7 81.43 292.27 79.73 293.41 78.51C294.62 77.23 296.17 76.32 298.06 75.79C300.03 75.26 302.11 74.99 304.31 74.99L317.71 74.99L317.71 75.22C317.71 78.17 317.07 80.94 315.78 83.51C314.49 86.01 312.68 88.06 310.33 89.65Z",
  },
  {
    id: "d",
    d: "M354.59 97.82C358.68 100.47 363.52 101.8 369.13 101.8C373.6 101.8 377.53 100.85 380.94 98.96C384.35 97.07 386.96 94.64 388.78 91.69L389.23 100.44L400.93 100.44L400.93 20.93L388.78 20.93L388.78 52.5C386.66 49.4 383.89 47.02 380.48 45.35C377.08 43.61 373.29 42.74 369.13 42.74C363.52 42.74 358.68 44.06 354.59 46.71C350.58 49.29 347.47 52.81 345.28 57.28C343.16 61.67 342.1 66.59 342.1 72.04C342.1 77.57 343.16 82.57 345.28 87.04C347.47 91.5 350.58 95.1 354.59 97.82ZM380.71 88.74C378.14 90.4 375.07 91.23 371.52 91.23C368.26 91.23 365.34 90.44 362.77 88.85C360.19 87.26 358.15 85.03 356.63 82.15C355.12 79.27 354.37 75.94 354.37 72.15C354.37 68.3 355.08 64.96 356.52 62.16C358.03 59.36 360.08 57.16 362.65 55.57C365.23 53.98 368.14 53.19 371.4 53.19C374.58 53.19 377.46 53.94 380.03 55.46C382.68 56.97 384.76 59.13 386.28 61.93C387.87 64.74 388.66 68.18 388.66 72.27C388.66 75.83 387.98 79.04 386.62 81.92C385.26 84.8 383.29 87.07 380.71 88.74Z",
  },
  {
    id: "e",
    d: "M425.27 98.05C429.51 100.55 434.39 101.8 439.92 101.8C444.61 101.8 448.7 100.97 452.18 99.3C455.67 97.63 458.55 95.4 460.82 92.6C463.17 89.8 464.83 86.69 465.82 83.29L453.32 83.29C452.18 86.01 450.44 88.13 448.1 89.65C445.83 91.08 443.06 91.8 439.81 91.8C436.78 91.8 434.09 91.12 431.74 89.76C429.4 88.32 427.54 86.39 426.18 83.97C424.81 81.47 424.02 78.63 423.79 75.45L467.07 75.45C467.22 74.39 467.29 73.48 467.29 72.72C467.37 71.96 467.41 71.05 467.41 70C467.41 64.77 466.23 60.12 463.89 56.03C461.61 51.94 458.43 48.72 454.34 46.37C450.25 43.95 445.49 42.74 440.03 42.74C434.43 42.74 429.47 43.99 425.16 46.49C420.91 48.91 417.62 52.31 415.27 56.71C412.92 61.1 411.75 66.29 411.75 72.27C411.75 78.02 412.92 83.13 415.27 87.6C417.69 92.07 421.03 95.55 425.27 98.05ZM455.14 66.93L423.91 66.93C424.44 62.16 426.25 58.6 429.36 56.25C432.46 53.9 435.9 52.73 439.69 52.73C443.93 52.73 447.53 54.02 450.48 56.59C453.43 59.09 454.99 62.54 455.14 66.93Z",
  },
  { id: "l", d: "M477.46 20.93L477.46 100.44L489.5 100.44L489.5 20.93L477.46 20.93Z" },
];
