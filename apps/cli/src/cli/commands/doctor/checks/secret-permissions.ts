import { join } from "node:path";

import { SecretFile } from "@/lib/project/secret-file";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` is owner-only, and secures it on fix. */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret is owner-only";

  protected async verify(ctx: CheckContext): Promise<void> {
    if (!(await SecretFile.isSecure(join(ctx.cwd, this.path)))) {
      throw new Error(".zitadel/secret can be read by others; expected 0600");
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    if (!ctx.dryRun) {
      await SecretFile.secure(join(ctx.cwd, this.path));
    }
  }
}
