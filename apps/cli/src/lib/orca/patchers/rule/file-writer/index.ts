import pReduce from "p-reduce";

import { AddDepOp } from "./ops/add-dep";
import { AppendOp } from "./ops/append";
import { AppendGitignoreOp } from "./ops/append-gitignore";
import { EditOp } from "./ops/edit";
import { MergeEnvOp } from "./ops/merge-env";
import { MergeJsonOp } from "./ops/merge-json";
import { MkdirOp } from "./ops/mkdir";
import { WriteOp } from "./ops/write";
import type { Operation } from "./operation";
import { Report } from "./report";
import type { FileOp, ScaffoldPlan, ScaffoldResult } from "./types";
import { Workspace, type WorkspaceOptions } from "./workspace";

/**
 * Applies a {@link ScaffoldPlan} to disk, executing its operations in order.
 *
 * Operations are idempotent: a write whose target already matches the desired
 * contents is recorded as skipped rather than rewritten, so re-running setup is
 * safe. With `dryRun` no filesystem changes are made but the result still
 * reflects what would have been written. Existing files are only overwritten
 * when `force` is set; otherwise an `E_CONFLICT` is thrown to protect
 * user-authored content. Paths in the plan are resolved relative to `cwd`.
 *
 * Each op is planned by its own class in `./ops` into one change, the
 * {@link Workspace} makes it, and the {@link Report} folds what happened.
 */
export class FileWriter {
  private readonly workspace: Workspace;

  /**
   * @param options - Where and how to apply plans.
   */
  constructor(options: WorkspaceOptions) {
    this.workspace = new Workspace(options);

    Object.freeze(this);
  }

  /**
   * @param plan - The operations to apply, in order.
   * @returns Every file the plan touched or skipped, and every dependency it added.
   * @throws `E_CONFLICT` when a file holds something else and `force` is not set.
   * @throws `E_VALIDATION` when an op cannot be applied, such as a dependency added without a `package.json`.
   */
  async scaffold(plan: ScaffoldPlan): Promise<ScaffoldResult> {
    const report = await pReduce(
      plan.ops,
      async (previous, op) => {
        const change = await this.operation(op).plan(this.workspace);
        const outcome = await this.workspace.commit(change);

        return previous.with(outcome);
      },
      Report.empty(),
    );

    return report.toResult(this.workspace.dryRun);
  }

  private operation(op: FileOp): Operation<FileOp["kind"]> {
    switch (op.kind) {
      case "mkdir":
        return new MkdirOp(op);
      case "write":
        return new WriteOp(op);
      case "append":
        return new AppendOp(op);
      case "merge-env":
        return new MergeEnvOp(op);
      case "merge-json":
        return new MergeJsonOp(op);
      case "append-gitignore":
        return new AppendGitignoreOp(op);
      case "add-dep":
        return new AddDepOp(op);
      case "edit":
        return new EditOp(op);
    }
  }
}
