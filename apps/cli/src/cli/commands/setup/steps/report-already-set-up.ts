import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import type { CommandResult } from "@/lib/oclif";
import { hostUnlessDefault } from "@/lib/server";
import type { Summary } from "@/lib/ui";
import { EndStep } from "@/lib/wizard";

/**
 * The line that says a directory already holds a setup.
 */
const ALREADY_SET_UP_TITLE = "Zitadel is already set up in this app";

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
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "alreadySetUp";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Whether the directory is set up.
   *
   * @param needs - What was settled before the first step.
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
    const title = this.deps.dryRun ? `${ALREADY_SET_UP_TITLE} (dry run)` : ALREADY_SET_UP_TITLE;
    const summary: Summary = {
      title,
      sections: [],
      lines: ["Nothing was changed."],
      ...(skippedHost === undefined ? {} : { ran: skippedHost }),
      boxed: true,
    };
    if (this.deps.dryRun) {
      return {
        status: "ok",
        data: {
          title,
          dry_run: true,
        },
        summary,
      };
    }
    return {
      status: "skipped",
      reason: "already-initialized",
      data: { title },
      summary,
    };
  }
}
