import { Fragment, type ReactNode } from "react";
import { CopyButton } from "./copy-button";

// A line's copy button shows on hover and focus, and always on touch screens.
const LINE_COPY =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100";

/** A command that wraps between words, never at the hyphens of a flag. */
export function Words({ text }: { text: string }) {
  return text.split(" ").map((word, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed command, never reordered
    <Fragment key={index}>
      {index > 0 && " "}
      <span className="whitespace-nowrap">{word}</span>
    </Fragment>
  ));
}

/**
 * A command at its prompt with its copy button, in every window that shows
 * one. A line too long for a phone wraps under its command, not its $.
 * `children` stands in for the command while it is typed out
 * (terminal-card.tsx); `end` adds a control before the copy button.
 */
export function CommandLine({
  command,
  children,
  end,
}: {
  command: string;
  children?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="group -mx-2 flex items-start gap-2 rounded-md px-2 transition-colors hover:bg-tint/[0.04]">
      <span className="flex-1 pl-[2ch] -indent-[2ch] text-text-primary">
        <span aria-hidden="true" className="select-none text-text-accent">
          {"$ "}
        </span>
        {children ?? <Words text={command} />}
      </span>
      {/* Centered on the first line of the command, whatever its height. */}
      <span className="my-[calc((1lh_-_1.75rem)/2)] flex shrink-0 items-center gap-2">
        {end}
        <CopyButton text={command} label={command} className={LINE_COPY} />
      </span>
    </div>
  );
}
