import { AbstractSanityCheck, type CheckContext } from "./types";
import { Project, ProjectConfigMissingError, ProjectSecretMissingError } from "@/lib/project";
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

/** What a project with no `.zitadel/secret` is reported as. */
const SECRET_MISSING_REFUSAL = {
  message: ".zitadel/secret was not found",
  hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
  next: [
    {
      id: "doctor",
      flags: {
        fix: true,
      },
    },
  ],
} as const satisfies Refusal;

/** Verifies `.zitadel/secret`'s project_id matches `zitadel.json`'s project. */
export class ProjectMatchCheck extends AbstractSanityCheck {
  readonly name = "project-match";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret project_id matches zitadel.json project";

  protected async verify(ctx: CheckContext): Promise<void> {
    try {
      const config = await Project.at(ctx.cwd).config();
      const secret = await Project.at(ctx.cwd).secret();
      const configProject =
        typeof config.data.project === "string" ? config.data.project : undefined;
      if (secret.data.project_id !== configProject) {
        throw new Error(".zitadel/secret project_id does not match zitadel.json project");
      }
    } catch (error) {
      if (error instanceof ProjectConfigMissingError) {
        throw refusalError(CONFIG_MISSING_REFUSAL, {});
      }
      if (error instanceof ProjectSecretMissingError) {
        throw refusalError(SECRET_MISSING_REFUSAL, {});
      }
      throw error;
    }
  }
}
