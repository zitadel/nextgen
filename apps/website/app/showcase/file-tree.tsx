import { Fragment } from "react";
import { CommandLine } from "../command-line";
import { WINDOW_BODY, WINDOW_INSET, Window } from "../window";
import type { Scaffold } from "./types";

/** A path that wraps only after a slash, never inside a name or after its +. */
function Path({ path }: { path: string }) {
  const parts = path.split("/");
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed path, never reordered
      <Fragment key={index}>
        <span className="whitespace-nowrap">{last ? part : `${part}/`}</span>
        {!last && <wbr />}
      </Fragment>
    );
  });
}

// One row's grid: from a small tablet up the note on the right, a path too
// long for its column wrapped after a slash; on a phone each note under its
// path, so no name is ever cut.
const ROW =
  "-mx-2 grid rounded-md px-2 py-1 text-left sm:col-span-2 sm:grid-cols-subgrid sm:items-baseline";

/**
 * What setup writes into the app, in a terminal in the app's folder: the
 * setup command at its prompt, then the new files it leaves, each path,
 * added, with what it is; the user model and the login
 * flow, which the next steps edit, in the accent. A page's row is a button
 * that opens it in the browser beside (`onOpen`), `open` the one it shows.
 */
export function FileTree({
  scaffold,
  open,
  onOpen,
}: {
  scaffold: Scaffold;
  open?: string;
  onOpen?: (path: string) => void;
}) {
  return (
    <Window title={scaffold.root} className="h-full">
      <div className={`flex flex-1 flex-col gap-3 ${WINDOW_BODY}`}>
        <CommandLine command={scaffold.command} />
        <ul className="grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
          {scaffold.entries.map((entry) => {
            const content = (
              <>
                <span className="pl-[2ch] -indent-[2ch] text-diff-added">
                  <span aria-hidden="true" className="select-none opacity-60">
                    +&nbsp;
                  </span>
                  <Path path={entry.path} />
                </span>
                <span
                  className={`pl-[2ch] font-sans text-xs sm:pl-0 sm:text-right ${entry.highlight ? "text-text-accent" : "text-text-muted"}`}
                >
                  {entry.page && (
                    <span
                      className={`mr-2 transition-opacity ${open === entry.path ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    >
                      {open === entry.path ? "Showing" : "Open →"}
                    </span>
                  )}
                  {entry.note}
                </span>
              </>
            );
            return (
              <li key={entry.path} className="grid sm:col-span-2 sm:grid-cols-subgrid">
                {entry.page && onOpen ? (
                  <button
                    type="button"
                    aria-pressed={open === entry.path}
                    onClick={() => onOpen(entry.path)}
                    className={`group cursor-pointer transition-colors ${ROW} ${
                      open === entry.path ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={ROW}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p
        className={`border-window-border border-t py-3 font-mono text-text-muted text-xs leading-5 ${WINDOW_INSET}`}
      >
        {scaffold.rest}
      </p>
    </Window>
  );
}
