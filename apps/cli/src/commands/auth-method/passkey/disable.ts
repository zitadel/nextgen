import { CommandGroups, type JsonEnvelope } from "../../../lib/oclif";
import { AuthMethodCommand, FORCE_FLAG, SCHEMA_FLAG } from "../shared";

/** `auth-method passkey disable` (ADR 069). */
export default class PasskeyDisable extends AuthMethodCommand {
  static override description = "Disable passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method passkey disable",
    "<%= config.bin %> auth-method passkey disable --schema customers",
  ];
  static override flags = { ...SCHEMA_FLAG, ...FORCE_FLAG };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PasskeyDisable);
    return this.toggle(flags, "passkey", false);
  }
}
