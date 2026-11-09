import { AuthMethodCommand } from "@/commands/auth-method/command";
import { Flags } from "@oclif/core";

import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

/** `auth-method password disable` (ADR 070). */
export default class AuthMethodPasswordDisable extends AuthMethodCommand {
  static override description = "Disable password sign-in for a user schema.";
  static override group = CommandGroups.authentication;

  static override heading = "Disabling password sign-in";
  static override examples = [
    "<%= config.bin %> auth-method password disable",
    "<%= config.bin %> auth-method password disable --schema customers",
  ];
  static override flags = {
    // `--force` is per command, not global (ADR 064 §10): here it permits
    // removing the last way to sign in, which the server allows for a schema
    // whose users are only managed through the API.
    force: Flags.boolean({
      char: "f",
      description:
        "Disable the schema's last way to sign in. Its users can then only be managed through the API.",
    }),
  };

  /**
   * Turn the method on or off for the schema `--schema` names.
   *
   * @param input - The run's `--schema` and `--cwd`.
   * @returns The result.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or the change
   *   would leave no way to sign in and nobody agreed to it.
   */
  protected async execute(
    input: Admitted<typeof AuthMethodPasswordDisable>,
  ): Promise<JsonEnvelope> {
    return this.toggle(input.flags, "password", false);
  }
}
