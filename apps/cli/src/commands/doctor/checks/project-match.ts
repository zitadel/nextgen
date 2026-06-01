import { readZitadelConfig, readZitadelSecret } from "../../../lib/project";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret`'s project_id matches `zitadel.json`'s project. */
export class ProjectMatchCheck extends AbstractSanityCheck {
  readonly name = "project-match";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret project_id matches zitadel.json project";

  protected async verify(ctx: CheckContext): Promise<void> {
    const config = await readZitadelConfig(ctx.cwd);
    const secret = await readZitadelSecret(ctx.cwd);
    const configProject = typeof config.project === "string" ? config.project : undefined;
    if (secret.project_id !== configProject) {
      throw new Error(".zitadel/secret project_id does not match zitadel.json project");
    }
  }
}
