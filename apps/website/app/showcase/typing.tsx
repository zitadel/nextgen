"use client";

import { type RefObject, useEffect, useState } from "react";
import { CommandLine } from "../command-line";
import { BAR_BUTTON } from "../window";
import { prefersReducedMotion, useSeen } from "./motion";

// A key a little faster than a person types, and the output a line at a time.
const KEY_MS = 32;
const ENTER_MS = 450;
const LINE_MS = 260;

export type Typing = {
  /** Whether it plays at all: not for reduced motion, nor before hydration. */
  motion: boolean;
  playing: boolean;
  /** How much of the command is typed. */
  typed: number;
  /** Whether the caret shows: while typing, and until the output starts. */
  caret: boolean;
  /** Whether output line `index` has printed. */
  printed: (index: number) => boolean;
  replay: () => void;
};

/**
 * A terminal's session played back once `ref` is mostly on screen: `command`
 * typed out key by key, then `lines` of output printed one at a time. For
 * reduced motion, and before the page hydrates, the whole session stands
 * still.
 */
export function useTyping(ref: RefObject<Element | null>, command: string, lines: number): Typing {
  const seen = useSeen(ref, { threshold: 0.6 });
  const end = command.length + lines;
  const [motion, setMotion] = useState(false);
  // How far the playback is: the command's characters, then the output's lines.
  const [frame, setFrame] = useState(end);

  useEffect(() => {
    if (!prefersReducedMotion()) {
      setMotion(true);
      setFrame(0);
    }
  }, []);

  useEffect(() => {
    if (!seen || frame >= end) {
      return;
    }
    const delay = frame < command.length ? KEY_MS : frame === command.length ? ENTER_MS : LINE_MS;
    const tick = setTimeout(() => setFrame((current) => current + 1), delay);
    return () => clearTimeout(tick);
  }, [seen, frame, end, command.length]);

  return {
    motion,
    playing: frame < end,
    typed: Math.min(frame, command.length),
    caret: frame <= command.length && frame < end,
    printed: (index) => frame > command.length + index,
    replay: () => setFrame(0),
  };
}

/**
 * The command at its prompt as far as it is typed, the caret after it while
 * it types. The rest of the command holds its place unseen, so nothing moves.
 */
export function TypedCommand({ command, typing }: { command: string; typing: Typing }) {
  const { typed, caret } = typing;
  return (
    <CommandLine command={command} placement="showcase">
      <span className="break-words">
        {command.slice(0, typed)}
        {caret && <span aria-hidden="true" className="caret" />}
        <span className="invisible">{command.slice(typed)}</span>
      </span>
    </CommandLine>
  );
}

/** Plays the session again; never disabled, which would drop a keyboard's focus. */
export function ReplayButton({ typing }: { typing: Typing }) {
  return (
    <button
      type="button"
      onClick={() => typing.playing || typing.replay()}
      aria-disabled={typing.playing}
      className={`${BAR_BUTTON} text-text-secondary aria-disabled:cursor-default aria-disabled:opacity-40`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5">
        <path
          d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77M2.75 2.75v3h3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Replay
    </button>
  );
}

/** Classes that fade output line `index` in once it has printed. */
export function printedClass(typing: Typing, index: number): string {
  return `transition-opacity duration-200 ${typing.printed(index) ? "opacity-100" : "opacity-0"}`;
}
