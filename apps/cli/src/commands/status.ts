import { BaseCommand, type JsonEnvelope } from "../lib/oclif/base";
import { runStatus } from "../lib/commands/status";

/** `zitadel status` — summarize the local project state. */
export default class Status extends BaseCommand {
  static override description = "Summarize the local project state.";

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Status);
    await this.toMeta(flags);
    return this.emit(await runStatus(this.meta));
  }
}
