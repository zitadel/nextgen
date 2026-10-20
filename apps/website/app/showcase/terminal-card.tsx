"use client";

import { useRef } from "react";
import { WINDOW_BODY, Window } from "../window";
import type { Recording } from "./types";
import { printedClass, ReplayButton, TypedCommand, useTyping } from "./typing";

/**
 * One of the hero's commands and what it printed, in a terminal window. Once
 * it is on screen it types the command and prints the output line by line,
 * and Replay plays it again (typing.tsx).
 */
export function TerminalCard({ recording }: { recording: Recording }) {
  const { command, output } = recording;
  const root = useRef<HTMLDivElement>(null);
  const typing = useTyping(root, command, output.length);

  return (
    <div ref={root} className="h-full">
      <Window
        title={recording.title}
        className="h-full"
        end={typing.motion && <ReplayButton typing={typing} />}
      >
        <div className={`flex flex-col gap-1 ${WINDOW_BODY}`}>
          <TypedCommand command={command} typing={typing} />
          {output.map((line, index) => (
            <div
              key={line}
              className={`break-words text-text-secondary ${printedClass(typing, index)}`}
            >
              {line}
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
}
