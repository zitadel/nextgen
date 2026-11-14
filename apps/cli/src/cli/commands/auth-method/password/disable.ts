import { Flags } from "@oclif/core";

import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

/**
 * `zitadel auth-method password disable` — disable password sign-in for a user schema.
 */
export default class AuthMethodPasswordDisable extends AuthMethodCommand {
  static override description = "Disable password sign-in for a user schema.";
  static override group = CommandGroups.authentication;

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
   * @param input.flags - The run's `--schema` and `--cwd`.
   * @returns The result.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or the change
   *   would leave no way to sign in and nobody agreed to it.
   */
  protected async execute({
    flags,
  }: Admitted<typeof AuthMethodPasswordDisable>): Promise<JsonEnvelope> {
    return this.toggle(flags, "password", false);
  }
}
