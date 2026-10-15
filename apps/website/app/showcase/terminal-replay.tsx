"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LINE_COPY } from "../command-block";
import { CopyButton } from "../copy-button";
import { GradientBorder, WindowDots } from "../gradient-border";
import type { Recording, TerminalLine } from "./types";

/** Milliseconds per typed character of a command. */
const TYPE_MS = 28;
/** Pause after a command is typed, before its output appears. */
const COMMAND_PAUSE_MS = 450;
/** Milliseconds between output lines. */
const OUTPUT_MS = 55;
/** Pause before the next command starts. */
const NEXT_COMMAND_PAUSE_MS = 350;
const START_DELAY_MS = 400;
/** How close to the bottom the reader has to be for the terminal to keep following the output. */
const FOLLOW_THRESHOLD_PX = 48;

type Frame = { line: number; chars: number; at: number };

/** Lines before `line` are complete, `line` shows `chars` characters, later lines are hidden. */
type Progress = { line: number; chars: number };

/** Which line the playback starts from; `run` changes to play the same range again. */
type Playback = { from: number; run: number };

function buildFrames(lines: TerminalLine[]): Frame[] {
  const frames: Frame[] = [];
  let at = 0;
  lines.forEach((line, index) => {
    if (line.type === "command") {
      if (index > 0) {
        at += NEXT_COMMAND_PAUSE_MS;
      }
      for (let chars = 1; chars <= line.text.length; chars += 1) {
        frames.push({ line: index, chars, at });
        at += TYPE_MS;
      }
      at += COMMAND_PAUSE_MS;
      return;
    }
    frames.push({ line: index, chars: line.text.length, at });
    at += line.text ? OUTPUT_MS : OUTPUT_MS / 2;
  });
  return frames;
}

/** Muted output and comments, the prompt in the accent, green and red for diff lines. */
const LINE_CLASSES: Record<TerminalLine["type"], string> = {
  command: "text-text-primary",
  output: "text-text-secondary",
  comment: "text-text-muted",
  added: "text-[#86efac]",
  removed: "text-[#f87171]",
};

/**
 * A recorded terminal session (zitadel/new-website's TerminalReplay). The
 * whole transcript is on screen from the start, so a reader passing by sees
 * the result and can copy any command. Replay plays it back, commands typed and
 * output appearing line by line, and any command can be clicked to play from
 * there; the terminal follows the output unless the reader scrolled up.
 * Visitors who prefer reduced motion get no playback. `onDoneChange` hears
 * false when a playback starts and true when the whole session is on screen.
 */
export function TerminalReplay({
  recording,
  onDoneChange,
}: {
  recording: Recording;
  onDoneChange?: (done: boolean) => void;
}) {
  const { title, lines } = recording;
  const frames = useMemo(() => buildFrames(lines), [lines]);
  const lastLine = lines.length - 1;
  const lastChars = lines[lastLine]?.text.length ?? 0;
  const complete = useMemo<Progress>(
    () => ({ line: lastLine, chars: lastChars }),
    [lastLine, lastChars],
  );

  const [progress, setProgress] = useState<Progress>(complete);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!playback || reducedMotion) {
      setProgress(complete);
      return;
    }
    const { from } = playback;
    const startAt = frames.find((frame) => frame.line >= from)?.at ?? 0;
    follow.current = true;
    setProgress({ line: from - 1, chars: from > 0 ? (lines[from - 1]?.text.length ?? 0) : 0 });
    const timers = frames
      .filter((frame) => frame.line >= from)
      .map((frame) =>
        window.setTimeout(
          () => setProgress({ line: frame.line, chars: frame.chars }),
          frame.at - startAt + START_DELAY_MS,
        ),
      );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [playback, reducedMotion, frames, lines, complete]);

  // Follows the output while it plays: runs on every step of the playback.
  useEffect(() => {
    const element = body.current;
    if (element && follow.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [progress]);

  const done = progress.line === lastLine && progress.chars >= lastChars;

  useEffect(() => {
    onDoneChange?.(done);
  }, [done, onDoneChange]);

  const onScroll = () => {
    const element = body.current;
    if (element) {
      follow.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
    }
  };

  const playFrom = useCallback(
    (from: number) => setPlayback((current) => ({ from, run: (current?.run ?? 0) + 1 })),
    [],
  );

  return (
    <GradientBorder className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-border-secondary border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <WindowDots />
          <span className="font-mono text-text-secondary text-xs leading-4">{title}</span>
        </div>
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => playFrom(0)}
            className="cursor-pointer font-semibold text-text-secondary text-xs leading-4 transition-colors hover:text-text-primary"
          >
            {playback && !done ? "Playing" : "Replay"}
          </button>
        )}
      </div>

      <div
        ref={body}
        onScroll={onScroll}
        className="scrollbar-hidden h-72 overflow-y-auto px-5 py-4 font-mono text-xs leading-5 md:h-[22rem] md:px-6 md:py-5 md:text-[0.8125rem] md:leading-[1.65]"
      >
        {lines.slice(0, progress.line + 1).map((line, index) => {
          const current = index === progress.line;
          const text = current ? line.text.slice(0, progress.chars) : line.text;
          const typing = current && line.type === "command" && progress.chars < line.text.length;
          const cursor = (typing || (current && done)) && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-text-primary motion-safe:animate-pulse"
            />
          );

          if (line.type === "command") {
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed recording, never reordered
                key={index}
                className="group -mx-2 flex items-start gap-2 rounded px-2 transition-colors hover:bg-surface-black-secondary"
              >
                <button
                  type="button"
                  title={reducedMotion ? undefined : "Play from here"}
                  disabled={reducedMotion}
                  onClick={() => playFrom(index)}
                  className={`flex-1 cursor-pointer whitespace-pre-wrap break-words text-left disabled:cursor-text ${LINE_CLASSES.command}`}
                >
                  <span className="text-text-accent">$ </span>
                  {text || " "}
                  {cursor}
                </button>
                <CopyButton text={line.text} label="the command" className={LINE_COPY} />
              </div>
            );
          }

          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed recording, never reordered
              key={index}
              className={`whitespace-pre-wrap break-words ${LINE_CLASSES[line.type]}`}
            >
              {text || " "}
              {cursor}
            </div>
          );
        })}
      </div>
    </GradientBorder>
  );
}
