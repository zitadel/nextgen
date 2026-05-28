import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { runSetup } from "../lib/commands/setup";
import { AUTH_METHODS } from "../lib/flows";
import { RENDERER_IDS } from "../lib/orca/patchers/rule/next/renderers/registry";

/** `zitadel setup` — create a project and scaffold local auth. */
export default class Setup extends BaseCommand {
  static override description = "Create a Zitadel project and scaffold local auth.";
  static override examples = ["<%= config.bin %> setup --framework next --auth-method passkey"];
  static override flags = {
    framework: Flags.string({ description: "Framework to target.", options: ["next"] }),
    "auth-method": Flags.string({
      description: "Auth method (default: passkey).",
      options: [...AUTH_METHODS],
    }),
    renderer: Flags.string({ description: "Renderer (default: react).", options: [...RENDERER_IDS] }),
    "no-apply": Flags.boolean({ description: "Skip the automatic apply at the end of setup." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    await this.toMeta(flags);
    return this.emit(
      await runSetup({
        ...this.meta,
        framework: flags.framework,
        authMethod: flags["auth-method"],
        renderer: flags.renderer,
        noApply: flags["no-apply"],
      }),
    );
  }
}
