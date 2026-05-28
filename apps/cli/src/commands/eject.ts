import { BaseCommand, type JsonEnvelope } from "../lib/oclif/base";
import { runEject } from "../lib/commands/eject";

/** `zitadel eject` — remove managed files and local Zitadel state. */
export default class Eject extends BaseCommand {
  static override description = "Remove managed files and local Zitadel state.";
  static override aliases = ["uninstall"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Eject);
    await this.toMeta(flags);
    return this.emit(await runEject({ ...this.meta, force: this.meta.force }));
  }
}
