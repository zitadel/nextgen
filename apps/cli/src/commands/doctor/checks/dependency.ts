import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadPatchContext } from "../patch-context";
import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies the project still declares a Zitadel SDK dependency in
 * `package.json`. The patcher adds a scoped package (e.g.
 * `@zitadel/sdk-next`); the check is generic over the `@zitadel*`
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

  /**
   * Repairs by re-applying the patcher's managed artifacts: rebuilds the
   * `PatchContext` from disk and calls `patcher.repair`, which re-adds the
   * SDK dependency via its `add-dep` op. The exact package name is framework
   * + renderer specific and known only to the patcher (which deliberately
   * hides its file-op plan behind the family-neutral `Patcher` interface),
   * so going through `repair` is the only sanctioned path. Missing-only:
   * the repair restores absent managed files as a side effect but never
   * overwrites an existing one, edited or not.
   */
  override async fix(ctx: CheckContext): Promise<void> {
    const patchCtx = await loadPatchContext(ctx.cwd, ctx.orca, ctx.cliVersion);
    await ctx.orca.patcherFor(patchCtx.framework.id).repair(patchCtx, {
      cwd: ctx.cwd,
      dryRun: ctx.dryRun,
      force: false,
      missingOnly: true,
    });
  }
}
