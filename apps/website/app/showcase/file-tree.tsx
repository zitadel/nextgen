import { Fragment } from "react";
import { GradientBorder, TITLE_BAR, WindowDots } from "../gradient-border";
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

/**
 * What setup writes into the app, as a card of new files under the app's
 * folder: each path, added, with what it is; the user model and the login
 * flow, which the next rows edit, in the accent. The hero has the commands,
 * so this shows what they leave behind.
 */
export function FileTree({ scaffold }: { scaffold: Scaffold }) {
  return (
    <GradientBorder className="overflow-hidden">
      <div className={`${TITLE_BAR} gap-3 px-5`}>
        <WindowDots />
        <span className="font-mono text-text-secondary text-xs leading-4">{scaffold.root}</span>
      </div>
      {/* From a small tablet up two columns, the notes aligned on the right
          and a path too long for its column wrapped after a slash; on a phone
          each note under its path, so no name is ever cut. */}
      <ul className="grid grid-cols-1 gap-y-2 px-5 py-4 font-mono text-xs leading-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-4 md:px-6 md:py-5 md:text-[0.8125rem]">
        {scaffold.entries.map((entry) => (
          <li
            key={entry.path}
            className="grid sm:col-span-2 sm:grid-cols-subgrid sm:items-baseline"
          >
            <span className="pl-[2ch] -indent-[2ch] text-[#86efac]">
              <span aria-hidden="true" className="select-none opacity-70">
                +&nbsp;
              </span>
              <Path path={entry.path} />
            </span>
            <span
              className={`pl-[2ch] font-sans text-xs sm:pl-0 sm:text-right ${entry.highlight ? "text-text-accent" : "text-text-muted"}`}
            >
              {entry.note}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-border-secondary border-t px-5 py-3 font-mono text-text-muted text-xs leading-5 md:px-6">
        {scaffold.rest}
      </p>
    </GradientBorder>
  );
}
