import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { runApply } from "../lib/commands/apply";
import { environmentSchema } from "../lib/api/schemas";

/** `zitadel apply` — validate and upload repo config to the platform. */
export default class Apply extends BaseCommand {
  static override description = "Validate and upload repo config to the platform.";
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Apply);
    await this.toMeta(flags);
    return this.emit(await runApply({ ...this.meta, environment: flags.environment }));
  }
}
