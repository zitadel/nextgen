import { CommandGroups, type JsonEnvelope } from "../../../lib/oclif";
import { AuthMethodCommand, FORCE_FLAG, SCHEMA_FLAG } from "../shared";

/** `auth-method password disable` (ADR 069). */
export default class PasswordDisable extends AuthMethodCommand {
  static override description = "Disable password sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method password disable",
    "<%= config.bin %> auth-method password disable --schema customers",
  ];
  static override flags = { ...SCHEMA_FLAG, ...FORCE_FLAG };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PasswordDisable);
    return this.toggle(flags, "password", false);
  }
}
