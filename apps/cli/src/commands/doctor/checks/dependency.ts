import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies the project still declares a Zitadel SDK dependency in
 * `package.json`. The patcher adds a scoped package (e.g.
 * `@zitadel-nextgen/sdk-next`); the check is generic over the `@zitadel*`
 * scope so any framework renderer's dependency satisfies it.
 */
export class DependencyCheck extends AbstractSanityCheck {
  readonly name = "dependency";
  readonly path = "package.json";
  protected readonly summary = "package.json depends on a Zitadel SDK package";

  protected async verify(ctx: CheckContext): Promise<void> {
    const pkg = JSON.parse(await readFile(join(ctx.cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    if (!names.some((name) => name.startsWith("@zitadel"))) {
      throw new Error("no @zitadel* dependency found in package.json");
    }
  }
}
