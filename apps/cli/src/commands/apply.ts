import { Flags } from "@oclif/core";

import { BaseCommand } from "../base";
import { runApply } from "../lib/commands/apply";

/** `zitadel apply` — validate and upload repo config to the platform. */
export default class Apply extends BaseCommand {
  static description = "Validate and upload repo config to the platform.";
  static flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Apply);
    await this.toMeta(flags);
    await runApply(this.io, { ...this.meta, environment: flags.environment });
  }
}
