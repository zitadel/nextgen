import type { ReactNode } from "react";
import type { Placement } from "./analytics";
import { CommandLine } from "./command-line";
import { CopyButton } from "./copy-button";
import { WINDOW_BODY, WINDOW_FOOTER, Window } from "./window";

/**
 * Commands to copy, in a terminal window: one button in the title bar for all
 * of them and one per line. `note` is the one prerequisite, beside the title;
 * `footer` a line under the commands; `placement` where the block sits.
 */
export function CommandBlock({
  title,
  note,
  lines,
  footer,
  placement,
}: {
  title: string;
  note?: string;
  lines: string[];
  footer?: ReactNode;
  placement: Placement;
}) {
  return (
    <Window
      title={title}
      className="w-full"
      end={
        <>
          {note && <span className="font-mono text-text-muted text-xs leading-4">{note}</span>}
          <CopyButton
            text={lines.join("\n")}
            label="all commands"
            withLabel
            event={{ snippet: "all", placement }}
          />
        </>
      }
    >
      <ol className={`flex flex-col gap-0.5 md:leading-6 ${WINDOW_BODY}`}>
        {lines.map((line) => (
          <li key={line}>
            <CommandLine command={line} placement={placement} />
          </li>
        ))}
      </ol>
      {footer && <div className={`${WINDOW_FOOTER} px-5 py-2.5`}>{footer}</div>}
    </Window>
  );
}
