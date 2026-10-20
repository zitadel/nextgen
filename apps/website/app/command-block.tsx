import { Fragment } from "react";
import { CopyButton } from "./copy-button";
import { GradientBorder, WindowDots } from "./gradient-border";

// A line's copy button shows on hover and focus, and always on touch screens.
export const LINE_COPY =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100";

/**
 * Commands to copy, in a terminal window: one button in the title bar for all
 * of them and one per line. `note` is the one prerequisite, beside the title.
 * A line too long for a phone wraps between words, never after the hyphens or
 * slashes inside one, and under its command, not its $.
 */
export function CommandBlock({
  title,
  note,
  lines,
}: {
  title: string;
  note?: string;
  lines: string[];
}) {
  return (
    <GradientBorder className="w-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-border-secondary border-b py-2 pr-3 pl-5">
        <div className="flex items-center gap-3">
          <WindowDots />
          <span className="font-mono text-text-secondary text-xs leading-4">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {note && <span className="font-mono text-text-muted text-xs leading-4">{note}</span>}
          <CopyButton text={lines.join("\n")} label="all commands" withLabel />
        </div>
      </div>
      <ol className="flex flex-col gap-0.5 px-5 py-4 font-mono text-xs leading-5 md:text-[0.8125rem] md:leading-6">
        {lines.map((line) => (
          <li
            key={line}
            className="group -mx-2 flex items-start gap-2 rounded px-2 transition-colors hover:bg-surface-black-secondary"
          >
            <span className="flex-1 pl-[2ch] -indent-[2ch] text-text-primary">
              <span aria-hidden="true" className="select-none text-text-accent">
                {"$ "}
              </span>
              {line.split(" ").map((word, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed command, never reordered
                <Fragment key={index}>
                  {index > 0 && " "}
                  <span className="whitespace-nowrap">{word}</span>
                </Fragment>
              ))}
            </span>
            <CopyButton text={line} label="the command" className={LINE_COPY} />
          </li>
        ))}
      </ol>
    </GradientBorder>
  );
}
