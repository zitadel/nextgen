import { Flags } from "@oclif/core";

import { BaseCommand } from "../base";
import { runDoctor } from "../lib/commands/doctor";

/** `zitadel doctor` — verify generated files and local state. */
export default class Doctor extends BaseCommand {
  static override description = "Verify generated files and local state.";
  static override flags = {
    fix: Flags.boolean({ description: "Re-apply missing managed files." }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    await this.toMeta(flags);
    await runDoctor(this.io, { ...this.meta, fix: flags.fix });
  }
}
