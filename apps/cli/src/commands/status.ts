import { BaseCommand } from "../base";
import { runStatus } from "../lib/commands/status";

/** `zitadel status` — summarize the local project state. */
export default class Status extends BaseCommand {
  static description = "Summarize the local project state.";

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    await this.toMeta(flags);
    await runStatus(this.io, this.meta);
  }
}
