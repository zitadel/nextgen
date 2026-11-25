import { AbstractSanityCheck, type CheckContext } from "./types";
import { OrcaFrameworkMissingError } from "@/lib/orca";
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

/** What a directory with no app of a framework orca knows is reported as. */
const FRAMEWORK_NOT_DETECTED_REFUSAL = {
  code: "E_FRAMEWORK_NOT_DETECTED",
  message: "Could not detect a supported app framework",
  hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
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
      if (error instanceof OrcaFrameworkMissingError) {
        throw refusalError(FRAMEWORK_NOT_DETECTED_REFUSAL, {});
      }
      throw error;
    }
  }
}
