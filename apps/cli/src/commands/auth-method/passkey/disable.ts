import { Flags } from "@oclif/core";

import { AuthMethodCommand, CommandGroups, type JsonEnvelope } from "../../../lib/oclif";

/** `auth-method passkey disable` (ADR 069). */
export default class AuthMethodPasskeyDisable extends AuthMethodCommand {
  static override description = "Disable passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
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

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodPasskeyDisable);
    return this.toggle(flags, "passkey", false);
  }
}
