import { SquareTerminal } from "lucide-react";

import { cliSetup } from "@/components/cli-hint";
import { CopyButton } from "@/components/ui/copy-button";
import { avatarVars } from "@/components/user-avatar";
import { serverOrigin } from "@/lib/server-origin";

/**
 * How to create a project, beside the Projects list (decisions log D24).
 *
 * A project is created from the app it signs people in to: the CLI's `setup`
 * creates it and connects the app in one step, and the console holds nothing
 * that could do the second half. So the home hands over that command, naming
 * this console's server, rather than a button or a form. What follows `setup`
 * depends on the deployment (on the hosted cloud the project is claimed next),
 * so the card leaves that to the steps the CLI prints.
 */
export function NewProjectCard({ first = false }: { first?: boolean }) {
  const command = cliSetup(serverOrigin());

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
            {first ? "Create your first project" : "Start a new project"}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A project is created from the app it signs people in to. Run this in your app’s folder:
        </p>
        {/* Wraps rather than scrolls: a `--server` origin can outrun the card,
            and the button copies the command whole either way. `wrap-anywhere`
            breaks at a space first, so the origin stays in one piece unless it
            is longer than a line. */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted pr-1 pl-3">
          <span aria-hidden className="py-1.5 font-mono text-xs leading-5 text-muted-foreground">
            $
          </span>
          <code className="min-w-0 flex-1 py-1.5 font-mono text-xs leading-5 text-foreground wrap-anywhere">
            {command}
          </code>
          <CopyButton value={command} label="Copy the setup command" size="sm" />
        </div>
        <p className="text-xs text-muted-foreground">
          It creates the project and connects your app. Follow the steps it prints to finish.
        </p>
      </div>
    </section>
  );
}
