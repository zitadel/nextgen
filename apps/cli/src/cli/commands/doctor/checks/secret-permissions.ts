import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Whether the platform keeps POSIX permission bits on a file. Windows
 * reports every file as `0666` and ignores `chmod`, so a mode check there
 * fails whatever the file's access list says.
 *
 * @param platform - The Node.js platform name, `process.platform`.
 * @returns `true` when `.zitadel/secret`'s mode can be read and set.
 */
export function keepsPosixModes(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

/** Verifies `.zitadel/secret` is locked down to `0600`, and re-locks it on fix. Passes where the platform has no POSIX modes. */
export class SecretPermissionsCheck extends AbstractSanityCheck {
  readonly name = "secret-permissions";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret has 0600 permissions";

  protected async verify(ctx: CheckContext): Promise<void> {
    if (!keepsPosixModes(process.platform)) {
      await stat(join(ctx.cwd, ".zitadel/secret"));
      return;
    }
    const mode = (await stat(join(ctx.cwd, ".zitadel/secret"))).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`expected 0600, got ${mode.toString(8)}`);
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    if (ctx.dryRun || !keepsPosixModes(process.platform)) {
      return;
    }
    await chmod(join(ctx.cwd, ".zitadel/secret"), 0o600);
  }
}
