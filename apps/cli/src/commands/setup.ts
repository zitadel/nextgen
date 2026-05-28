import { Flags } from "@oclif/core";

import { BaseCommand } from "../base";
import { runSetup } from "../lib/commands/setup";

/** `zitadel setup` — create a project and scaffold local auth. */
export default class Setup extends BaseCommand {
  static description = "Create a Zitadel project and scaffold local auth.";
  static examples = ["<%= config.bin %> setup --framework next --auth-method passkey"];
  static flags = {
    framework: Flags.string({ description: 'Framework to target (v1 supports "next").' }),
    "user-fields": Flags.string({ description: "Comma-separated list of user fields." }),
    "auth-method": Flags.string({ description: "Auth method: passkey (default) or password." }),
    renderer: Flags.string({ description: "Renderer: react (default) or web-component." }),
    "no-apply": Flags.boolean({ description: "Skip the automatic apply at the end of setup." }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Setup);
    await this.toMeta(flags);
    await runSetup(this.io, {
      ...this.meta,
      framework: flags.framework,
      userFields: flags["user-fields"],
      authMethod: flags["auth-method"],
      renderer: flags.renderer,
      noApply: flags["no-apply"],
    });
  }
}
