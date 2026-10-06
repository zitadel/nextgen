import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";

import { AUTH_TOGGLE_FLAGS, AuthToggleCommand } from "./toggle";

/** The `auth disable` command (ADR 070). */
export default class AuthDisable extends AuthToggleCommand {
  static override description = "Disable password or passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth disable --mode passkey",
    "<%= config.bin %> auth disable --mode passkey --schema customers",
  ];
  static override flags = AUTH_TOGGLE_FLAGS;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthDisable);
    return this.toggle(flags, false);
  }
}
