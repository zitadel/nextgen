import { EnvironmentCommand } from "@/cli/core";
import { Destructive } from "@/cli/core/destructive";
import { Previewable } from "@/cli/core/previewable";
import { Tabulatable } from "@/cli/core/tabulatable";

import { ServerCommand } from "./server-command";

/**
 * A command about one project on one server: the server comes from `--server`
 * or the environment, the project from the environment. Every command in a
 * topic that talks to a project starts here, so none composes the pair itself.
 */
export const ProjectCommand = ServerCommand(EnvironmentCommand);

/**
 * A command that reads from the project and shows what it read: a record or a
 * list, with `--fields` and `--plain` to shape it.
 */
export const ReadCommand = Tabulatable(ProjectCommand);

/**
 * A command that changes the project, and so has a dry run: it says what it
 * would do in `preview` and does it in `apply`.
 */
export const ChangeCommand = Previewable(ProjectCommand);

/**
 * A command that removes something from the project: a change that asks for
 * consent first, which `--force` gives.
 *
 * @param forces - What `--force` does here, where the default sentence is not all of it.
 * @returns The class to extend.
 */
export function RemoveCommand(forces?: string) {
  return Destructive(Previewable(ProjectCommand), forces);
}
