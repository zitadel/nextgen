import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { runApply } from "./apply";
import { environmentSchema } from "../lib/api/schemas";

/** `zitadel plan` — validate config and preview the sync diff without mutating. */
export default class Plan extends BaseCommand {
  static override description = "Validate config without mutation and preview the sync diff.";
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Plan);
    await this.toMeta(flags);
    return this.emit(await runApply({ ...this.meta, dryRun: true, environment: flags.environment }));
  }
}
