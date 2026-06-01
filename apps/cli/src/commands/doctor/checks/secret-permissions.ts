import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` is locked down to `0600`, and re-locks it on fix. */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret has 0600 permissions";

  protected async verify(ctx: CheckContext): Promise<void> {
    const mode = (await stat(join(ctx.cwd, ".zitadel/secret"))).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`expected 0600, got ${mode.toString(8)}`);
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    if (ctx.dryRun) {
      return;
    }
    await chmod(join(ctx.cwd, ".zitadel/secret"), 0o600);
  }
}
