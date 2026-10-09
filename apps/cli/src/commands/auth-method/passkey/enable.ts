import { CommandGroups, type JsonEnvelope } from "../../../lib/oclif";
import { AuthMethodCommand, SCHEMA_FLAG } from "../shared";

/** `auth-method passkey enable` (ADR 069). */
export default class PasskeyEnable extends AuthMethodCommand {
  static override description = "Enable passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method passkey enable",
    "<%= config.bin %> auth-method passkey enable --schema customers",
  ];
  static override flags = { ...SCHEMA_FLAG };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PasskeyEnable);
    return this.toggle(flags, "passkey", true);
  }
}
