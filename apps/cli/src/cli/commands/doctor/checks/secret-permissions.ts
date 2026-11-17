import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies `.zitadel/secret` is locked down to `0600`, and re-locks it on fix.
 * Windows has no file modes, so there it only checks that the file exists and
 * says so.
 */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary: string;
  private readonly keepsModes: boolean;

  /**
   * @param platform - The Node.js platform name; only tests pass it.
   */
  constructor(platform: NodeJS.Platform = process.platform) {
    super();
    this.keepsModes = platform !== "win32";
    this.summary = this.keepsModes
      ? ".zitadel/secret has 0600 permissions"
      : ".zitadel/secret exists (Windows has no file modes to check)";
  }

  protected async verify(ctx: CheckContext): Promise<void> {
    const mode = (await stat(join(ctx.cwd, ".zitadel/secret"))).mode & 0o777;
    if (this.keepsModes && mode !== 0o600) {
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
