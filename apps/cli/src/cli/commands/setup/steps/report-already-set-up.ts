import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { hostUnlessDefault } from "@/lib/server";

import type { CommandResult } from "@/lib/oclif";
import { EndStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"preflight">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "dryRun">;

/**
 * Ends the run for an app already set up: it has nothing left to scaffold.
 */
export class ReportAlreadySetUp extends EndStep<"alreadySetUp", CommandResult, Needs> {
  readonly key = "alreadySetUp";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Whether the directory is set up.
   *
   * @param needs - What was settled before the first step.
   * @param _services - What the command provides.
   * @returns Whether to end here.
   */
  when(needs: Needs): boolean {
    return needs.preflight.configured;
  }

  /**
   * Say that nothing was changed.
   *
   * @remarks
   * The result for a directory that is already set up and has nothing to move.
   *
   * @param needs - What was settled before the first step.
   * @returns The result.
   */
  async run(needs: Needs): Promise<CommandResult> {
    const skippedHost = hostUnlessDefault(needs.preflight.server.value);
    const alreadyTitle = this.deps.dryRun
      ? "Zitadel is already set up in this app (dry run)"
      : "Zitadel is already set up in this app";
    const alreadySummary = {
      title: alreadyTitle,
      sections: [],
      lines: ["Nothing was changed."],
      ...(skippedHost === undefined ? {} : { ran: skippedHost }),
      boxed: true as const,
    };
    if (this.deps.dryRun) {
      return {
        status: "ok",
        data: {
          title: alreadyTitle,
          dry_run: true,
        },
        summary: alreadySummary,
      };
    }

    return {
      status: "skipped",
      reason: "already-initialized",
      data: { title: alreadyTitle },
      summary: alreadySummary,
    };
  }
}
