import { AbstractSanityCheck, type CheckContext } from "./types";
import { Project } from "@/lib/project";

/** Verifies `.zitadel/secret` exists and parses. */
export class SecretCheck extends AbstractSanityCheck {
  readonly name = "secret";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret parses";

  protected async verify(ctx: CheckContext): Promise<void> {
    await Project.at(ctx.cwd).secret();
  }
}
