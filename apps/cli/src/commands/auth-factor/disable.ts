import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";

import { AUTH_FACTOR_FLAGS, AuthFactorCommand } from "./toggle";

/** The `auth-factor disable` command (ADR 070). */
export default class AuthFactorDisable extends AuthFactorCommand {
  static override description = "Disable password or passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-factor disable --mode passkey",
    "<%= config.bin %> auth-factor disable --mode passkey --schema customers",
  ];
  static override flags = AUTH_FACTOR_FLAGS;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthFactorDisable);
    return this.toggle(flags, false);
  }
}
