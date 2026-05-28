import { BaseCommand } from "../base";
import { runEject } from "../lib/commands/eject";

/** `zitadel eject` — remove managed files and local Zitadel state. */
export default class Eject extends BaseCommand {
  static description = "Remove managed files and local Zitadel state.";
  static aliases = ["uninstall"];

  async run(): Promise<void> {
    const { flags } = await this.parse(Eject);
    await this.toMeta(flags);
    await runEject(this.io, { ...this.meta, force: this.meta.force });
  }
}
