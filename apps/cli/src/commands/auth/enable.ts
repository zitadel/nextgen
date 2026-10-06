import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";

import { AUTH_TOGGLE_FLAGS, AuthToggleCommand } from "./toggle";

/** The `auth enable` command (ADR 070). */
export default class AuthEnable extends AuthToggleCommand {
  static override description = "Enable password or passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth enable --mode passkey",
    "<%= config.bin %> auth enable --mode password --mode passkey --schema customers",
  ];
  static override flags = AUTH_TOGGLE_FLAGS;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthEnable);
    return this.toggle(flags, true);
  }
}
