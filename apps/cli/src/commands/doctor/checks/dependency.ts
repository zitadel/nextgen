import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadPatchContext } from "../patch-context";
import { resolveArtifacts } from "./managed-files";
import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies the project still declares every package its Zitadel integration
 * imports. The patcher knows them (`@zitadel/sdk-next`, or a meta-framework's
 * server SDK plus the widget SDK its pages import), so the check requires
 * exactly those; another `@zitadel/*` package, such as the CLI as a
 * devDependency, does not stand in for a missing one. When the framework
 * cannot be resolved (the framework check reports why), any `@zitadel/*`
 * dependency passes.
 */
export class DependencyCheck extends AbstractSanityCheck {
  readonly name = "dependency";
  readonly path = "package.json";
  protected readonly summary = "package.json depends on the Zitadel SDK packages the app imports";

  protected async verify(ctx: CheckContext): Promise<void> {
    const pkg = JSON.parse(await readFile(join(ctx.cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const required = (await resolveArtifacts(ctx))?.dependencies;
    if (required === undefined || required.length === 0) {
      if (![...names].some((name) => name.startsWith("@zitadel"))) {
        throw new Error("no @zitadel* dependency found in package.json");
      }
      return;
    }
    const missing = required.filter((name) => !names.has(name));
    if (missing.length > 0) {
      throw new Error(`package.json does not declare ${missing.join(", ")}, which the app imports`);
    }
  }

  /**
   * Repairs by re-applying the patcher's managed artifacts: rebuilds the
   * `PatchContext` from disk and calls `patcher.repair`, which re-adds the
   * SDK dependencies via their `add-dep` ops. The exact package names are
   * framework + renderer specific and known only to the patcher (which
   * deliberately hides its file-op plan behind the family-neutral `Patcher`
   * interface), so going through `repair` is the only sanctioned path.
   * Missing-only: the repair restores absent managed files as a side effect
   * but never overwrites an existing one, edited or not.
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
