import { useCurrentFrame } from "remotion";

import { GLASS } from "../glass";

import { FRAMES_PER_BEAT, HEIGHT, WIDTH, beats, seconds } from "../timeline";
import { keystrokes } from "./typing";

// Before the login, where it comes from: a terminal in a new app's folder
// running the README's quick start (apps/website/app/commands.ts). `start`
// prints what the website's recorded session printed; `setup` lists the files
// that session wrote, the user model and the login flow lit; `npm run dev`
// ends on the app's address, a line of our own, and the cut opens its login.

const PROMPT = "myapp $ ";

/** A line of output: plain, muted, a success, or lit as what matters most. */
type Line = { text: string; tone?: "muted" | "success" | "lit" };

type Step = {
  command: string;
  /** When its typing starts and ends, in frames from the scene's start. */
  typing: [number, number];
  /** Its output, a line every few frames after Enter. */
  output: Line[];
};

/** Enter, a few frames after the last key; the output follows. */
const ENTER_AFTER = seconds(0.13);
const OUTPUT_AFTER = seconds(0.23);
const OUTPUT_GAP = seconds(0.13);

const STEPS: Step[] = [
  {
    command: "npx @zitadel/cli@latest start",
    typing: [beats(1.7), beats(4.3)],
    output: [
      { text: "Local Zitadel server is ready.", tone: "success" },
      { text: "(server: localhost:8080)", tone: "muted" },
    ],
  },
  {
    command: "npx @zitadel/cli@latest setup --framework next --server local",
    typing: [beats(6.4), beats(10.4)],
    output: [
      { text: "+ app/login/page.tsx          Login page" },
      { text: "+ app/register/page.tsx       Registration page" },
      { text: "+ app/profile/page.tsx        Profile page" },
      { text: "+ proxy.ts                    Next.js proxy" },
      { text: "+ .zitadel/schemas/default-human-user.json   User model", tone: "lit" },
      { text: "+ .zitadel/flows/default-login.json          Login flow", tone: "lit" },
    ],
  },
  {
    command: "npm run dev",
    typing: [beats(13.2), beats(14)],
    output: [{ text: "✓ Ready on http://localhost:3000", tone: "success" }],
  },
];

/** Each step's keystrokes and Enter, in frames from the scene's start, for the picture and the key sounds. */
export const CLI_KEYS = STEPS.map(({ command, typing: [from, to] }) => ({
  keys: keystrokes(command, from, to, `cli-${command}`),
  enter: to + ENTER_AFTER,
}));

/** The website's terminal colours (apps/website/app/globals.css). */
const COLORS = {
  ground: "#050505",
  edge: "rgb(255 255 255 / 0.08)",
  text: "#f4f4f6",
  muted: "#82829c",
  lit: "#f25543",
  success: "#5fd99a",
  prompt: "#bba5e4",
};

const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';
const SIZE = 34;

export function Cli() {
  const frame = useCurrentFrame();

  // The terminal so far: each command as typed, its output once entered, and
  // the next prompt, its caret waiting, once the output is all there.
  const lines: { prompt?: boolean; text: string; tone?: Line["tone"]; caret?: boolean }[] = [];
  for (const [index, step] of STEPS.entries()) {
    const { keys, enter } = CLI_KEYS[index] ?? { keys: [], enter: 0 };
    const typed = keys.filter((at) => at <= frame).length;
    const entered = frame >= enter;
    lines.push({ prompt: true, text: step.command.slice(0, typed), caret: !entered });
    if (!entered) {
      break;
    }
    const shown = step.output.filter((_, at) => frame >= enter + OUTPUT_AFTER + at * OUTPUT_GAP);
    lines.push(...shown);
    if (shown.length < step.output.length || index === STEPS.length - 1) {
      break;
    }
    lines.push({ text: "" });
  }
  const lastKey = Math.max(
    Number.NEGATIVE_INFINITY,
    ...CLI_KEYS.flatMap(({ keys }) => keys.filter((at) => at <= frame)),
  );

  // Solid while typing; otherwise on for the first half of every beat.
  const caretOn =
    frame - lastKey < FRAMES_PER_BEAT || frame % FRAMES_PER_BEAT < FRAMES_PER_BEAT / 2;
  const tone = (line: Line["tone"]) =>
    line === "muted"
      ? COLORS.muted
      : line === "lit"
        ? COLORS.lit
        : line === "success"
          ? COLORS.success
          : COLORS.text;

  return (
    <div
      style={{
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        background: COLORS.ground,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* A soft glow in Zitadel's orange and lilac behind the window,
          coming out around its edges, mostly at two opposite corners. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            "radial-gradient(58% 70% at 10% 90%, rgb(242 85 67 / 0.42), transparent 72%)",
            "radial-gradient(60% 72% at 90% 10%, rgb(187 165 228 / 0.36), transparent 72%)",
          ].join(", "),
        }}
      />
      <div
        style={{
          position: "relative",
          width: 1560,
          height: 900,
          borderRadius: 20,
          ...GLASS,
          // Mostly opaque, so the glow stays behind the window and only
          // faintly shows through; the glass keeps its edge and its light.
          background: "rgb(20 20 23 / 0.84)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 56,
            background: "rgb(255 255 255 / 0.03)",
            borderBottom: `1px solid ${COLORS.edge}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 22px",
            fontFamily: FONT,
            fontSize: 20,
            color: COLORS.muted,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((dot) => (
            <span
              key={dot}
              style={{ width: 14, height: 14, borderRadius: 7, background: dot, opacity: 0.85 }}
            />
          ))}
          <span style={{ flex: 1, textAlign: "center", marginRight: 80 }}>~/myapp</span>
        </div>
        <div
          style={{
            padding: "40px 48px",
            fontFamily: FONT,
            fontSize: SIZE,
            lineHeight: 1.6,
            color: COLORS.text,
            whiteSpace: "pre",
          }}
        >
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines only ever append
            <div key={index} style={{ color: tone(line.tone), minHeight: SIZE * 1.6 }}>
              {line.prompt && <span style={{ color: COLORS.prompt }}>{PROMPT}</span>}
              {line.text}
              {line.caret && caretOn && (
                <span
                  style={{
                    display: "inline-block",
                    width: "0.6em",
                    height: "1.1em",
                    verticalAlign: "text-bottom",
                    background: COLORS.text,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
