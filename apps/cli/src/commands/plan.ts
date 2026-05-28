import { Flags } from "@oclif/core";

import { BaseCommand } from "../base";
import { runApply } from "../lib/commands/apply";

/** `zitadel plan` — validate config and preview the sync diff without mutating. */
export default class Plan extends BaseCommand {
  static override description = "Validate config without mutation and preview the sync diff.";
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Plan);
    await this.toMeta(flags);
    await runApply(this.io, {
      ...this.meta,
      dryRun: true,
      planOnly: true,
      environment: flags.environment,
    });
  }
}
