import { CommandGroups, type JsonEnvelope } from "../../../lib/oclif";
import { AuthMethodCommand, SCHEMA_FLAG } from "../shared";

/** `auth-method password enable` (ADR 069). */
export default class PasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];
  static override flags = { ...SCHEMA_FLAG };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PasswordEnable);
    return this.toggle(flags, "password", true);
  }
}
