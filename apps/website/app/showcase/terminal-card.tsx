import { LINE_COPY } from "../command-block";
import { CopyButton } from "../copy-button";
import { GradientBorder, TITLE_BAR, WindowDots } from "../gradient-border";
import type { Recording } from "./types";

/**
 * One of the hero's commands and what it printed, in a terminal window: the
 * command in the hero's colours, with its copy button, then its output,
 * muted. Static, unlike the narrative's replaying terminal: the step explains
 * the line, it does not type it out again.
 */
export function TerminalCard({ recording }: { recording: Recording }) {
  return (
    <GradientBorder className="overflow-hidden">
      <div className={`${TITLE_BAR} gap-3 px-5`}>
        <WindowDots />
        <span className="font-mono text-text-secondary text-xs leading-4">{recording.title}</span>
      </div>
      <div className="flex flex-col gap-1 px-5 py-4 font-mono text-xs leading-5 md:px-6 md:py-5 md:text-[0.8125rem]">
        <div className="group -mx-2 flex items-start gap-2 rounded px-2 transition-colors hover:bg-surface-black-secondary">
          <span className="flex-1 whitespace-pre-wrap break-words text-text-primary">
            <span aria-hidden="true" className="select-none text-text-accent">
              {"$ "}
            </span>
            {recording.command}
          </span>
          <CopyButton text={recording.command} label="the command" className={LINE_COPY} />
        </div>
        {recording.output.map((line) => (
          <div key={line} className="break-words text-text-secondary">
            {line}
          </div>
        ))}
      </div>
    </GradientBorder>
  );
}
