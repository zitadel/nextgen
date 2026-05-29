import { stat } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` is locked down to `0600`. */
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
}
