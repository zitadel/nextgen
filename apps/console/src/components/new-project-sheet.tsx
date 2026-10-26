import type { ReactNode } from "react";

import { cliSetup } from "@/components/cli-hint";
import { FormSheet, FormSheetHeader } from "@/components/form-sheet";
import { CopyButton } from "@/components/ui/copy-button";
import { SheetDescription } from "@/components/ui/sheet";
import { serverOrigin } from "@/lib/server-origin";

/**
 * The New project drawer, opened from beside the Projects title (decisions log
 * D15, D21).
 *
 * A project is created from the app it signs people in to: the CLI's `setup`
 * creates it and connects the app in one step, and the console holds nothing
 * that could do the second half. So the drawer hands over that command, naming
 * this console's server, rather than a form. What follows `setup` depends on
 * the deployment (on the hosted cloud the project is claimed next), so the
 * drawer leaves that to the steps the CLI prints.
 */
export function NewProjectSheet({
  children,
}: {
  /** The trigger: the Projects title's `New project` button. */
  children: ReactNode;
}) {
  return <FormSheet trigger={children}>{() => <NewProjectSteps />}</FormSheet>;
}

function NewProjectSteps() {
  const command = cliSetup(serverOrigin());

  return (
    <>
      <FormSheetHeader title="New project" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 text-sm">
        <SheetDescription className="text-foreground">
          A project is created from the app it signs people in to. Run this in your app’s folder:
        </SheetDescription>
        {/* Wraps rather than scrolls: a `--server` origin can outrun the
            drawer, and the button copies the command whole either way.
            `wrap-anywhere` breaks at a space first, so the origin stays in
            one piece unless it is longer than a line. */}
        <div className="bg-muted flex items-start gap-2 rounded-md border border-border pr-1 pl-3">
          <code className="text-foreground min-w-0 flex-1 py-1.5 font-mono text-xs leading-5 wrap-anywhere">
            {command}
          </code>
          <CopyButton value={command} label="Copy the setup command" size="sm" />
        </div>
        <p className="text-muted-foreground">
          It creates the project and connects your app. Follow the steps it prints to finish.
        </p>
      </div>
    </>
  );
}
