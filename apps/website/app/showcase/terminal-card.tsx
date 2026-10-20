"use client";

import { useEffect, useRef, useState } from "react";
import { CommandLine } from "../command-line";
import { BAR_BUTTON, WINDOW_BODY, Window } from "../window";
import { prefersReducedMotion, useSeen } from "./motion";
import type { Recording } from "./types";

// A key a little faster than a person types, and the output a line at a time.
const KEY_MS = 32;
const ENTER_MS = 450;
const LINE_MS = 260;

/**
 * One of the hero's commands and what it printed, in a terminal window. Once
 * it is on screen it types the command and prints the output line by line,
 * and Replay plays it again; for reduced motion, and before the page
 * hydrates, the whole session stands still. Every character holds its place
 * while hidden, so nothing around the window moves while it plays.
 */
export function TerminalCard({ recording }: { recording: Recording }) {
  const { command, output } = recording;
  const end = command.length + output.length;
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeen(root, { threshold: 0.6 });
  const [motion, setMotion] = useState(false);
  // How far the replay is: the command's characters, then the output's lines.
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

  const typed = Math.min(frame, command.length);
  const playing = frame < end;

  return (
    <div ref={root} className="h-full">
      <Window
        title={recording.title}
        className="h-full"
        end={
          motion && (
            <button
              type="button"
              // Not disabled while it plays, which would drop a keyboard's focus.
              onClick={() => playing || setFrame(0)}
              aria-disabled={playing}
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
          )
        }
      >
        <div className={`flex flex-col gap-1 ${WINDOW_BODY}`}>
          <CommandLine command={command}>
            <span className="break-words">
              {command.slice(0, typed)}
              {frame <= command.length && playing && <span aria-hidden="true" className="caret" />}
              <span className="invisible">{command.slice(typed)}</span>
            </span>
          </CommandLine>
          {output.map((line, index) => (
            <div
              key={line}
              className={`break-words text-text-secondary transition-opacity duration-200 ${
                frame > command.length + index ? "opacity-100" : "opacity-0"
              }`}
            >
              {line}
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
}
