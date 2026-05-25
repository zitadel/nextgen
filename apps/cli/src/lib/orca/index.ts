import type { Patcher, PatchContext } from "./patchers/types";
import type { Scaffolder } from "./scaffolders/types";
import type { OrcaResult } from "./types";

/**
 * The Orca orchestrator coordinates framework scaffolding and project patching.
 * It selects the appropriate scaffolder or patcher based on the provided context
 * and delegates execution to the chosen implementation.
 */
export class Orca {
  private readonly scaffolders: readonly Scaffolder[];
  private readonly patchers: readonly Patcher[];

  constructor(scaffolders: readonly Scaffolder[], patchers: readonly Patcher[]) {
    this.scaffolders = scaffolders;
    this.patchers = patchers;
  }

  /**
   * Patches an existing project with the Zitadel integration.
   * Selects the first registered patcher that supports the detected framework
   * and delegates the full integration plan to it.
   *
   * @throws {Error} when no registered patcher supports the project's framework.
   */
  async patch(ctx: PatchContext): Promise<OrcaResult> {
    const patcher = this.patchers.find((p) => p.canPatch(ctx.framework.id));
    if (!patcher) {
      throw new Error(
        `No patcher supports framework "${ctx.framework.id}". Registered patchers: ${this.patchers.map((p) => p.constructor.name).join(", ")}`,
      );
    }
    return patcher.patch(ctx);
  }

  /**
   * Returns the list of frameworks that can be scaffolded from scratch,
   * derived exclusively from the registered active scaffolders.
   */
  availableFrameworks(): ReadonlyArray<{ id: string; displayName: string }> {
    return this.scaffolders.map((s) => ({
      id: s.supportedFrameworks[0] ?? s.kind,
      displayName: s.displayName,
    }));
  }
}
