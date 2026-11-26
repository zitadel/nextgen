import { stat } from "@/lib/fs";
import { join } from "node:path";

import { SecretFile } from "@/lib/project/secret-file";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` is as private as its filesystem allows, and secures it on fix. */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret is as private as its filesystem allows";

  protected async verify(ctx: CheckContext): Promise<void> {
    const file = join(ctx.cwd, this.path);
    if (!(await SecretFile.isSecure(file))) {
      throw new Error(`expected 0600, got ${((await stat(file)).mode & 0o777).toString(8)}`);
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    if (!ctx.dryRun) {
      await SecretFile.secure(join(ctx.cwd, this.path));
    }
  }
}
