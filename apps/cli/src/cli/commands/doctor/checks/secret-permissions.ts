import { join } from "node:path";

import { SecretFile } from "@/lib/project/secret-file";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` is locked down to `0600`, and re-locks it on fix. Passes where the platform has no modes. */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret has 0600 permissions";

  protected async verify(ctx: CheckContext): Promise<void> {
    const loose = await SecretFile.looseMode(join(ctx.cwd, this.path));
    if (loose !== undefined) {
      throw new Error(`expected 0600, got ${loose.toString(8)}`);
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    if (!ctx.dryRun) {
      await SecretFile.relock(join(ctx.cwd, this.path));
    }
  }
}
