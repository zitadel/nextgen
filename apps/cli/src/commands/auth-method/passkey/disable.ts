import { AuthMethodCommand } from "@/commands/auth-method/command";
import { Flags } from "@oclif/core";

import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

/** `auth-method passkey disable` (ADR 070). */
export default class AuthMethodPasskeyDisable extends AuthMethodCommand {
  static override description = "Disable passkey sign-in for a user schema.";
  static override group = CommandGroups.authentication;

  static override examples = [
    "<%= config.bin %> auth-method passkey disable",
    "<%= config.bin %> auth-method passkey disable --schema customers",
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
  protected async execute(input: Admitted<typeof AuthMethodPasskeyDisable>): Promise<JsonEnvelope> {
    return this.toggle(input.flags, "passkey", false);
  }
}
