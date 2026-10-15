import { GradientBorder, WindowDots } from "../gradient-border";
import type { Scaffold } from "./types";

/**
 * What setup writes into the app, as a card of new files under the app's
 * folder: each path, added, with what it is; the user model and the login
 * flow, which the next rows edit, in the accent. The hero has the commands,
 * so this shows what they leave behind.
 */
export function FileTree({ scaffold }: { scaffold: Scaffold }) {
  return (
    <GradientBorder className="overflow-hidden">
      <div className="flex items-center gap-3 border-border-secondary border-b px-5 py-3">
        <WindowDots />
        <span className="font-mono text-text-secondary text-xs leading-4">{scaffold.root}</span>
      </div>
      {/* Two columns: a path too long for the first wraps inside it, and the
          notes stay aligned on the right. */}
      <ul className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 px-5 py-4 font-mono text-xs leading-5 md:px-6 md:py-5 md:text-[0.8125rem]">
        {scaffold.entries.map((entry) => (
          <li key={entry.path} className="col-span-2 grid grid-cols-subgrid items-baseline">
            <span className="break-words pl-[2ch] -indent-[2ch] text-[#86efac]">
              <span aria-hidden="true" className="select-none opacity-70">
                {"+ "}
              </span>
              {entry.path}
            </span>
            <span
              className={`text-right font-sans text-xs ${entry.highlight ? "text-text-accent" : "text-text-muted"}`}
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
