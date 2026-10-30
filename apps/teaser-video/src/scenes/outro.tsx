import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import { useFonts } from "../login-surface";
import { Logo } from "../logo";
import { HEIGHT, OUTRO, WIDTH, beats } from "../timeline";

// The outro: out of the dark, the curved glow of a horizon rises into the
// dark frame's bottom edge, as a planet's rim looks from orbit, and "Try it
// out" comes into focus in the middle. On the last hit the logo replaces the
// words and plays as it does in the website's nav; then the frame scrolls up,
// as if coming down through the atmosphere, the logo fading, until the glow
// fills it.

/**
 * Zitadel's orange with a deeper ember, and the website's lilac with a deeper
 * violet and a blend of the two families between them.
 */
const EMBER = "#c2381f";
const ORANGE = "#f25543";
const MAGENTA = "#b8407a";
const VIOLET = "#5b3f9e";
const LILAC = "#bba5e4";
/** The website's page ground. */
const GROUND = "#0f0f11";

/** The logo's width, in px of the 1920-wide frame. */
const LOGO_WIDTH = 260;
const CALL_TO_ACTION = "Try it out";

/**
 * How far the frame scrolls: far enough to carry the logo out of it, short of
 * the full gradient, so the top keeps a band of purple.
 */
const SCROLL_DISTANCE = 0.8 * HEIGHT;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * Where a lobe of color sits on the page and how it wanders: its centre's
 * offset from the horizon's middle, in frame widths, and its height, in frame
 * heights from the page's top; its radii; and a slow sideways drift.
 */
type Lobe = {
  color: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  drift: number;
  period: number;
};

// Two lobes break the horizon's perfect arc: purple swelling up on the left,
// orange pushing up on the right, each drifting on its own slow beat.
const LOBES: Lobe[] = [
  { color: `${VIOLET}cc`, x: -0.27, y: 1.0, rx: 0.36, ry: 0.3, drift: 0.04, period: 9 },
  { color: `${ORANGE}d9`, x: 0.22, y: 1.1, rx: 0.32, ry: 0.24, drift: 0.05, period: 7 },
];

/** The blur that melts every edge between the colors, in px. */
const SOFTNESS = 70;

/**
 * The page the outro scrolls, two frames tall. One wide ellipse, centred on
 * its foot, rises into the first frame's lower half: orange at its core
 * reaching up into the first frame, then magenta and violet, and a lilac haze
 * at its rim, so from the top the colors run purple to orange, like an
 * atmosphere over a lit surface. The lobes make its rim uneven, and a heavy
 * blur leaves no edge between the colors. The layer overhangs the frame, so
 * the blur's own soft border never shows. `arrive` runs from 0 to 1 as it
 * comes in out of the dark.
 */
function Page({ seconds, arrive }: { seconds: number; arrive: number }) {
  const breathe = 0.02 * HEIGHT * Math.sin((2 * Math.PI * seconds) / 7);
  // The layer's left edge sits a tenth of a frame left of the frame's.
  const middle = 0.6 * WIDTH;
  const lobes = LOBES.map(({ color, x, y, rx, ry, drift, period }) => {
    const sway = drift * WIDTH * Math.sin((2 * Math.PI * seconds) / period);
    return `radial-gradient(ellipse ${rx * WIDTH}px ${ry * HEIGHT}px at ${middle + x * WIDTH + sway}px ${y * HEIGHT}px in oklab, ${color}, transparent)`;
  });
  return (
    <div
      style={{
        position: "absolute",
        left: -0.1 * WIDTH,
        top: 0,
        width: 1.2 * WIDTH,
        height: 2.2 * HEIGHT,
        // Arriving, it comes up out of a far heavier blur, rising a little.
        filter: `blur(${SOFTNESS + (1 - arrive) * 120}px)`,
        opacity: arrive,
        transform: `translateY(${(1 - arrive) * 140}px)`,
        background: [
          ...lobes,
          `radial-gradient(ellipse ${1.3 * WIDTH}px ${1.38 * HEIGHT + breathe}px at ${middle}px ${2 * HEIGHT}px in oklab, ${EMBER} 0%, ${ORANGE} 40%, ${ORANGE} 58%, ${MAGENTA} 72%, ${VIOLET} 86%, ${LILAC}66 94%, ${LILAC}00 100%)`,
          // Under it, the same run straight down, so the second frame's
          // corners, outside the ellipse, still show color.
          `linear-gradient(to bottom in oklab, ${GROUND} 0%, ${GROUND} 30%, ${VIOLET} 46%, ${MAGENTA} 62%, ${ORANGE} 80%)`,
        ].join(", "),
      }}
    />
  );
}

export function Outro() {
  useFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  const logoFrom = beats(OUTRO.logo);
  const scroll = interpolate(
    frame,
    [beats(OUTRO.scroll), beats(OUTRO.scroll + OUTRO.scrollLength)],
    [0, 1],
    // Eases in gently and settles slowly, so the descent ends without a stop.
    { ...clamp, easing: Easing.bezier(0.45, 0, 0.15, 1) },
  );
  // The logo blurs away, gone by the time the scroll is halfway.
  const logoOut = interpolate(scroll, [0, 0.5], [0, 1], clamp);
  // Out of the dark, the gradient rises and the words come into focus.
  const arrive = interpolate(frame, [0, beats(OUTRO.logo)], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const wordsIn = interpolate(frame, [4, 34], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ background: GROUND, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          height: 2 * HEIGHT,
          transform: `translateY(${-scroll * SCROLL_DISTANCE}px)`,
        }}
      >
        <Page seconds={seconds} arrive={arrive} />
        <div
          style={{
            position: "absolute",
            top: 0,
            width: WIDTH,
            height: HEIGHT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fafafa",
          }}
        >
          {frame < logoFrom ? (
            <span
              style={{
                fontFamily: "Arimo, system-ui, sans-serif",
                fontWeight: 500,
                fontSize: 64,
                letterSpacing: "-0.01em",
                opacity: wordsIn,
                filter: `blur(${(1 - wordsIn) * 24}px)`,
                transform: `scale(${1.04 - wordsIn * 0.04})`,
              }}
            >
              {CALL_TO_ACTION}
            </span>
          ) : (
            <Logo
              id="outro"
              entering
              seconds={(frame - logoFrom) / fps}
              style={{
                width: LOGO_WIDTH,
                height: "auto",
                opacity: 1 - logoOut,
                filter: `blur(${logoOut * 24}px)`,
              }}
            />
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
