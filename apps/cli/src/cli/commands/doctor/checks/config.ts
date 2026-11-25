import { AbstractSanityCheck, type CheckContext } from "./types";
import { Project, ProjectConfigMissingError } from "@/lib/project";
import { refusalError, type Refusal } from "@/cli/core/refusal";

/** What a directory with no `zitadel.json` is reported as. */
const CONFIG_MISSING_REFUSAL = {
  message: "zitadel.json was not found",
  hint: "Set the project up first.",
  next: [
    {
      id: "setup",
    },
  ],
} as const satisfies Refusal;

/** Verifies `zitadel.json` exists and parses. */
export class ConfigCheck extends AbstractSanityCheck {
  readonly name = "config";
  readonly path = "zitadel.json";
  protected readonly summary = "zitadel.json parses";

  protected async verify(ctx: CheckContext): Promise<void> {
    try {
      await Project.at(ctx.cwd).config();
    } catch (error) {
      if (error instanceof ProjectConfigMissingError) {
        throw refusalError(CONFIG_MISSING_REFUSAL, {});
      }
      throw error;
    }
  }
}
