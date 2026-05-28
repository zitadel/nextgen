import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif/base";
import { runSetup } from "../lib/commands/setup";

/** `zitadel setup` — create a project and scaffold local auth. */
export default class Setup extends BaseCommand {
  static override description = "Create a Zitadel project and scaffold local auth.";
  static override examples = ["<%= config.bin %> setup --framework next --auth-method passkey"];
  static override flags = {
    framework: Flags.string({ description: 'Framework to target (v1 supports "next").' }),
    "user-fields": Flags.string({ description: "Comma-separated list of user fields." }),
    "auth-method": Flags.string({ description: "Auth method: passkey (default) or password." }),
    renderer: Flags.string({ description: "Renderer: react (default) or web-component." }),
    "no-apply": Flags.boolean({ description: "Skip the automatic apply at the end of setup." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    await this.toMeta(flags);
    return this.emit(
      await runSetup({
        ...this.meta,
        framework: flags.framework,
        userFields: flags["user-fields"],
        authMethod: flags["auth-method"],
        renderer: flags.renderer,
        noApply: flags["no-apply"],
      }),
    );
  }
}
