import { AbstractSanityCheck, type CheckContext } from "./types";
import { refusalError, type Refusal } from "@/cli/core/refusal";
import { Project, ProjectConfigMissingError } from "@/lib/project";

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

/** Verifies the framework detected on disk matches the one recorded in config. */
export class FrameworkCheck extends AbstractSanityCheck {
  readonly name = "framework";
  readonly path = "zitadel.json";
  protected readonly summary = "Detected framework matches recorded framework";

  protected async verify(ctx: CheckContext): Promise<void> {
    try {
      const config = await Project.at(ctx.cwd).config();
      const detected = await ctx.orca.detect(ctx.cwd);
      const recorded = config.frameworkId;
      if (recorded !== detected.id) {
        throw new Error(`expected ${String(recorded)}, detected ${detected.id}`);
      }
    } catch (error) {
      if (error instanceof ProjectConfigMissingError) {
        throw refusalError(CONFIG_MISSING_REFUSAL, {});
      }
      throw error;
    }
  }
}
