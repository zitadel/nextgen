import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { hostUnlessDefault } from "@/lib/server";

import type { JsonEnvelope } from "@/lib/oclif";
import { EndStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"preflight">;

/**
 * Ends the run for an app already set up: it has nothing left to scaffold.
 */
export class ReportAlreadySetUp extends EndStep<
  "alreadySetUp",
  JsonEnvelope,
  Needs,
  SetupServices
> {
  readonly key = "alreadySetUp";

  /**
   * Whether the directory is set up.
   *
   * @param needs - What was settled before the first step.
   * @param _services - What the command provides.
   * @returns Whether to end here.
   */
  when(needs: Needs, _services: SetupServices): boolean {
    return needs.preflight.configured;
  }

  /**
   * Say that nothing was changed.
   *
   *
   * The result for a directory that is already set up and has nothing to move.
   * @param needs - What was settled before the first step.
   * @param services - What the command provides.
   * @returns The result.
   */
  async run(needs: Needs, services: SetupServices): Promise<JsonEnvelope> {
    const skippedHost = hostUnlessDefault(needs.preflight.server.value);
    const alreadyTitle = services.dryRun
      ? "Zitadel is already set up in this app (dry run)"
      : "Zitadel is already set up in this app";
    const alreadySummary = {
      title: alreadyTitle,
      sections: [],
      lines: ["Nothing was changed."],
      ...(skippedHost === undefined ? {} : { ran: skippedHost }),
      boxed: true as const,
    };
    if (services.dryRun) {
      return services.emit({
        status: "ok",
        data: {
          title: alreadyTitle,
          dry_run: true,
        },
        summary: alreadySummary,
      });
    }

    return services.emit({
      status: "skipped",
      reason: "already-initialized",
      data: { title: alreadyTitle },
      summary: alreadySummary,
    });
  }
}
