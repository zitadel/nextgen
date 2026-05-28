import { scaffold } from "../../file-writer";
import type { FileOp, ScaffoldPlan } from "../../file-writer/plan";
import { zitadelBaseOps } from "../base-files";
import type {
  EjectActions,
  Patcher,
  PatchContext,
  PatchExecOptions,
  PatchResult,
  PatchView,
} from "../types";
import { reclaimableOps } from "./reclaim";

/**
 * Base for rule-based (deterministic, template-driven) patchers, as opposed to
 * a future LLM-driven family. It applies the integration by building a
 * file-operation plan and running the file-writer — that strategy stays
 * entirely inside this family, so callers only ever see the family-neutral
 * {@link Patcher} surface. Owns the framework-agnostic `.zitadel/` base files
 * (via {@link zitadelBaseOps}) and the shared eject classification; subclasses
 * contribute only their framework-specific routes/middleware.
 */
export abstract class AbstractRulePatcher implements Patcher {
  abstract canPatch(framework: string): boolean;

  /** Apply the full plan (base `.zitadel/` files + framework routes). */
  async patch(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    return scaffold(this.plan(ctx), opts);
  }

  /**
   * Re-apply only the reclaimable subset — env files, gitignore, the SDK
   * dependency, and marker-bearing routes — leaving the user-editable
   * `.zitadel/` resources untouched. Backs `doctor --fix`.
   */
  async repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    const plan = this.plan(ctx);
    return scaffold({ ops: reclaimableOps(plan), summary: plan.summary }, opts);
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

  /**
   * The full file-operation plan this patcher would apply. Public so rule-family
   * unit tests can assert the planned ops directly; the generic {@link Patcher}
   * interface deliberately does not expose it (an LLM patcher has no such plan).
   */
  plan(ctx: PatchContext): ScaffoldPlan {
    return {
      ops: [...zitadelBaseOps(ctx), ...this.routeOps(ctx)],
      summary: [this.summary(ctx)],
    };
  }

  /** Framework-specific route/middleware write ops plus the SDK dependency. */
  protected abstract routeOps(ctx: PatchContext): FileOp[];
  /** Framework-specific managed (marker-bearing) file paths, for ejection. */
  protected abstract routeFiles(view: PatchView): ReadonlyArray<string>;
  /** One-line summary of what the integration scaffolded. */
  protected abstract summary(ctx: PatchContext): { title: string; detail: string };
}
