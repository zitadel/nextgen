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

import { HEIGHT, WIDTH } from "../timeline";

// The call to action, before the logo: "Try it out" and the command that
// does, the one the video opened on (apps/website/app/commands.ts); above,
// the frameworks `setup` scaffolds (apps/cli/src/lib/orca/scaffolders), and
// below, over the rising glow, the coding agents the README names. Each mark
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

const FONT = "Arimo, system-ui, sans-serif";
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** How far `frame` is into a blur-in that starts at `from`: 0 out of focus, 1 sharp. */
const focusIn = (frame: number, from: number, length = 14) =>
  interpolate(frame, [from, from + length], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

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

function Label({ children, style }: { children: string; style: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 18,
        letterSpacing: 5,
        textTransform: "uppercase",
        color: "rgb(255 255 255 / 0.55)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The screen `frame` frames into the outro; `leave` runs from 0 to 1 as it
 * blurs away for the logo.
 */
export function CallToAction({ frame, leave }: { frame: number; leave: number }) {
  const words = focusIn(frame, 4, 30);
  const command = focusIn(frame, 14, 24);
  return (
    <div style={{ position: "absolute", width: WIDTH, height: HEIGHT, color: "#fafafa" }}>
      <div
        style={{
          position: "absolute",
          top: 150,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
        }}
      >
        <Label style={focused(focusIn(frame, 6), leave)}>Works with your framework</Label>
        <div style={{ display: "flex", gap: 64 }}>
          {FRAMEWORKS.map((icon, index) => (
            <span
              key={icon.slug}
              style={{ display: "flex", ...focused(focusIn(frame, 10 + index * 4), leave) }}
            >
              <Mark icon={icon} size={52} />
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <span
          style={{
            fontFamily: FONT,
            fontWeight: 500,
            fontSize: 72,
            letterSpacing: "-0.01em",
            transform: `scale(${1.04 - words * 0.04})`,
            ...focused(words, leave),
          }}
        >
          Try it out
        </span>
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

      <div
        style={{
          position: "absolute",
          bottom: 130,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
        }}
      >
        <Label style={focused(focusIn(frame, 24), leave)}>Built for AI agents</Label>
        <div style={{ display: "flex", gap: 72, fontFamily: FONT, fontSize: 30, fontWeight: 500 }}>
          {AGENTS.map(({ name, icon }, index) => (
            <span
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                ...focused(focusIn(frame, 28 + index * 6), leave),
              }}
            >
              {icon && <Mark icon={icon} size={40} />}
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
