import type { CSSProperties } from "react";
import {
  type SimpleIcon,
  siAngular,
  siClaude,
  siCursor,
  siGithubcopilot,
  siNextdotjs,
  siNuxt,
  siQwik,
  siReact,
  siSolid,
  siSvelte,
  siTanstack,
  siVuedotjs,
} from "simple-icons";
import { Easing, interpolate } from "remotion";

import { HEIGHT, WIDTH, seconds } from "../timeline";

// The call to action, before the logo: "Meet the new Zitadel", the promise
// under it and the command that keeps it, the one the video opened on (apps/website/app/commands.ts); above,
// unlabelled, the frameworks `setup` scaffolds
// (apps/cli/src/lib/orca/scaffolders), and below, over the rising glow, the
// coding agents the README names. Each mark
// comes into focus after the one before. The marks are Simple Icons'
// (simple-icons, CC0), and their owners' trademarks: check each owner's rules
// before the video goes out. OpenAI publishes no mark there, so Codex shows
// as its name alone.

const COMMAND = "npx @zitadel/cli@latest start";

const FRAMEWORKS: SimpleIcon[] = [
  siNextdotjs,
  siNuxt,
  siReact,
  siVuedotjs,
  siSvelte,
  siAngular,
  siSolid,
  siQwik,
  siTanstack,
];

const AGENTS: { name: string; icon?: SimpleIcon }[] = [
  { name: "Claude Code", icon: siClaude },
  { name: "Cursor", icon: siCursor },
  { name: "Copilot", icon: siGithubcopilot },
  { name: "Codex" },
];

/** The space between each row of marks and the words, the same above and below. */
const ROW_GAP = 230;
/** Both rows of marks take the same height, so the gaps measure alike. */
const ROW: CSSProperties = { display: "flex", alignItems: "center", height: 56 };

const FONT = "Arimo, system-ui, sans-serif";
/** Zitadel's heading face, as the website's headings use it (fonts.css). */
const HEADING = '"APK Futural", Arimo, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * How far `frame` is into a blur-in that starts `from` seconds in and lasts
 * `length`: 0 out of focus, 1 sharp.
 */
const focusIn = (frame: number, from: number, length = 0.23) =>
  interpolate(frame, [seconds(from), seconds(from + length)], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

const focused = (share: number, leave: number): CSSProperties => ({
  opacity: share * (1 - leave),
  filter: `blur(${Math.max(1 - share, leave) * 18}px)`,
});

function Mark({ icon, size }: { icon: SimpleIcon; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="img">
      <title>{icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}

/**
 * The screen `frame` frames into the outro; `leave` runs from 0 to 1 as it
 * blurs away for the logo.
 */
export function CallToAction({ frame, leave }: { frame: number; leave: number }) {
  // The name first, the promise under it, then the command that keeps it.
  const words = focusIn(frame, 0.07, 0.5);
  const promise = focusIn(frame, 0.23, 0.43);
  const command = focusIn(frame, 0.4, 0.4);
  return (
    // One column, so the two rows of marks sit the same distance above and
    // below the words, and the whole stays centred on the frame.
    <div
      style={{
        position: "absolute",
        width: WIDTH,
        height: HEIGHT,
        color: "#fafafa",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: ROW_GAP,
      }}
    >
      <div style={{ ...ROW, gap: 64 }}>
        {FRAMEWORKS.map((icon, index) => (
          <span
            key={icon.slug}
            style={{ display: "flex", ...focused(focusIn(frame, 0.17 + index * 0.07), leave) }}
          >
            <Mark icon={icon} size={52} />
          </span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 64 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            fontFamily: FONT,
          }}
        >
          <span
            style={{
              fontFamily: HEADING,
              fontWeight: 400,
              fontSize: 80,
              letterSpacing: "-0.01em",
              transform: `scale(${1.04 - words * 0.04})`,
              ...focused(words, leave),
            }}
          >
            Meet the new Zitadel
          </span>
          <span
            style={{
              fontSize: 34,
              color: "rgb(255 255 255 / 0.7)",
              ...focused(promise, leave),
            }}
          >
            Build your login in under a minute
          </span>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 30,
            padding: "18px 30px",
            borderRadius: 14,
            background: "rgb(255 255 255 / 0.06)",
            border: "1px solid rgb(255 255 255 / 0.14)",
            ...focused(command, leave),
          }}
        >
          <span style={{ color: "#bba5e4" }}>$ </span>
          {COMMAND}
        </span>
      </div>

      <div style={{ ...ROW, gap: 72, fontFamily: FONT, fontSize: 30, fontWeight: 500 }}>
        {AGENTS.map(({ name, icon }, index) => (
          <span
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              ...focused(focusIn(frame, 0.47 + index * 0.1), leave),
            }}
          >
            {icon && <Mark icon={icon} size={40} />}
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
