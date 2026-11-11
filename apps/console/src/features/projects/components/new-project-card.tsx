import { SquareTerminal } from "lucide-react";

import { avatarVars } from "@/components/user-avatar";

import { SetupCommand } from "./setup-command";

/**
 * How to create a first project: what Projects shows in place of an empty
 * list (decisions log D27).
 *
 * A project is created from the app it signs people in to: the CLI's `setup`
 * creates it and connects the app in one step, and the console holds nothing
 * that could do the second half. So the card hands over that command rather
 * than a button or a form. Once there is a project the same command sits
 * behind `New project` (`NewProjectSheet`).
 */
export function NewProjectCard() {
  return (
    <section
      aria-labelledby="new-project-title"
      className="relative overflow-hidden rounded-md border border-border bg-card text-card-foreground"
    >
      {/* The generated gradient the project marks are drawn from, as a band:
          what a new project's mark will be cut from. */}
      <span
        aria-hidden
        className="zl-avatar zl-avatar-moving absolute inset-x-0 top-0 h-1 rounded-none!"
        style={avatarVars("new-project")}
      />
      <div className="flex flex-col gap-4 p-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
            <SquareTerminal aria-hidden strokeWidth={1.5} className="size-4.5 text-foreground" />
          </span>
          <h2 id="new-project-title" className="font-serif text-base leading-5 text-foreground">
            Create your first project
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A project is created from the app it signs people in to. Run this in your app’s folder:
        </p>
        <SetupCommand />
        <p className="text-xs text-muted-foreground">
          It creates the project and connects your app. Follow the steps it prints to finish.
        </p>
      </div>
    </section>
  );
}
