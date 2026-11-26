import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Project } from "@/lib/project";

/**
 * How a command that needs a project refuses a directory `setup` has not made
 * one. `{why}` is the command's own reason, a sentence that ends in a period.
 */
export const NOT_A_PROJECT_REFUSAL = {
  message: "This directory is not a Zitadel project",
  hint: "Run setup first; {why}",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/**
 * Refuses `cwd` unless `setup` made it a project, that is, it holds a
 * `zitadel.json`.
 *
 * @remarks
 * For a command that creates files under `.zitadel/`. One that edits an
 * existing file already fails on the missing file.
 *
 * @param cwd - The directory the command runs in.
 * @param why - What the command needs the project for, for the hint.
 * @throws {@link ZitadelError} `E_VALIDATION` when it is not a project.
 */
export async function refuseOutsideProject(cwd: string, why: string): Promise<void> {
  if (!(await Project.at(cwd).hasConfig())) {
    throw refusalError(NOT_A_PROJECT_REFUSAL, { why });
  }
}
