import type { FileOp, ScaffoldPlan } from "../../file-writer/plan";
import { zitadelBaseOps } from "../base-files";
import type { EjectActions, Patcher, PatchContext, PatchView } from "../types";

/**
 * Base for rule-based (deterministic, template-driven) patchers, as opposed to
 * a future LLM-driven family. Owns the framework-agnostic `.zitadel/` base
 * files (via {@link zitadelBaseOps}) and the shared eject classification;
 * subclasses contribute only their framework-specific routes/middleware. Pure:
 * `plan` and `artifacts` perform no I/O.
 */
export abstract class AbstractRulePatcher implements Patcher {
  abstract canPatch(framework: string): boolean;

  /** Base `.zitadel/` files plus the subclass's framework routes. */
  plan(ctx: PatchContext): ScaffoldPlan {
    return {
      ops: [...zitadelBaseOps(ctx), ...this.routeOps(ctx)],
      summary: [this.summary(ctx)],
    };
  }

  /** Shared base artifacts plus the subclass's marker-bearing route files. */
  artifacts(view: PatchView): EjectActions {
    return {
      markedFiles: this.routeFiles(view),
      rootConfigFiles: ["zitadel.json"],
      directories: [".zitadel"],
      envBackups: [".env.local"],
    };
  }

  /** Framework-specific route/middleware write ops plus the SDK dependency. */
  protected abstract routeOps(ctx: PatchContext): FileOp[];
  /** Framework-specific managed (marker-bearing) file paths, for ejection. */
  protected abstract routeFiles(view: PatchView): ReadonlyArray<string>;
  /** One-line summary of what the integration scaffolded. */
  protected abstract summary(ctx: PatchContext): { title: string; detail: string };
}
