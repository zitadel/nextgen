import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ManagedFilesCheck, resolveArtifacts } from "./managed-files";
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
   * Repairs through the managed-files repair, which re-applies the patcher's
   * managed artifacts: its `add-dep` ops re-add the SDK dependencies. The exact
   * package names are framework + renderer specific and known only to the
   * patcher (which deliberately hides its file-op plan behind the
   * family-neutral `Patcher` interface), so going through `repair` is the only
   * sanctioned path. Delegating to the managed-files check keeps its boundary
   * handling: a restored Next 16 `proxy.ts` is never created beside an edited
   * `middleware.ts`, however the repair was started.
   */
  override async fix(ctx: CheckContext): Promise<void> {
    await new ManagedFilesCheck().fix(ctx);
  }
}
