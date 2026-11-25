import { AbstractSanityCheck, type CheckContext } from "./types";
import { Project } from "@/lib/project";

/** Verifies `.zitadel/secret`'s project_id matches `zitadel.json`'s project. */
export class ProjectMatchCheck extends AbstractSanityCheck {
  readonly name = "project-match";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret project_id matches zitadel.json project";

  protected async verify(ctx: CheckContext): Promise<void> {
    const config = await Project.at(ctx.cwd).config();
    const secret = await Project.at(ctx.cwd).secret();
    const configProject = typeof config.data.project === "string" ? config.data.project : undefined;
    if (secret.data.project_id !== configProject) {
      throw new Error(".zitadel/secret project_id does not match zitadel.json project");
    }
  }
}
