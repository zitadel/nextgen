import type { ReactNode } from "react";

import { FormSheet, FormSheetHeader } from "@/components/form-sheet";
import { SheetDescription } from "@/components/ui/sheet";

import { ProjectLifecycle } from "./project-lifecycle";
import { SetupCommand } from "./setup-command";

/**
 * The New project drawer, opened from beside the Projects title (decisions log
 * D15, D19, D27).
 *
 * A project is created from the app it signs people in to: the CLI's `setup`
 * creates it and connects the app in one step, and the console holds nothing
 * that could do the second half. So the drawer hands over that command rather
 * than a form, and under it how a project goes from that command to
 * production. What follows `setup` depends on the deployment (on the hosted
 * cloud the project is claimed next), so the drawer leaves that to the steps
 * the CLI prints.
 */
export function NewProjectSheet({
  children,
}: {
  /** The trigger: the Projects title's `New project` button. */
  children: ReactNode;
}) {
  return (
    <FormSheet trigger={children}>
      {() => (
        <>
          <FormSheetHeader title="New project" />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 text-sm">
            <SheetDescription className="text-foreground">
              A project is created from the app it signs people in to. Run this in your app’s
              folder:
            </SheetDescription>
            <SetupCommand />
            <p className="text-muted-foreground">
              It creates the project and connects your app. Follow the steps it prints to finish.
            </p>
            <ProjectLifecycle className="mt-4 border-t border-border pt-8" />
          </div>
        </>
      )}
    </FormSheet>
  );
}
