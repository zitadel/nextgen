import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";

import { AUTH_FACTOR_FLAGS, AuthFactorCommand } from "./toggle";

/** The `auth-factor enable` command (ADR 070). */
export default class AuthFactorEnable extends AuthFactorCommand {
  static override description = "Enable password or passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-factor enable --mode passkey",
    "<%= config.bin %> auth-factor enable --mode password --mode passkey --schema customers",
  ];
  static override flags = AUTH_FACTOR_FLAGS;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthFactorEnable);
    return this.toggle(flags, true);
  }
}
