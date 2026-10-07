import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";

import { AUTH_FACTOR_FLAGS, AuthFactorCommand } from "./toggle";

/** The `auth-factor disable` command (ADR 068). */
export default class AuthFactorDisable extends AuthFactorCommand {
  static override description = "Disable password or passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-factor disable --mode passkey",
    "<%= config.bin %> auth-factor disable --mode passkey --schema customers",
    "<%= config.bin %> auth-factor disable --mode password --mode passkey --schema api-users --force",
  ];
  static override flags = {
    ...AUTH_FACTOR_FLAGS,
    // `--force` is per command, not global: here it permits removing the last
    // factor, which the server allows for API-managed schemas (ADR 068 §3).
    force: Flags.boolean({
      char: "f",
      description:
        "Disable the schema's last factor. Its users can then only be managed through the API.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthFactorDisable);
    return this.toggle(flags, false);
  }
}
