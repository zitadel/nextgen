import { AuthMethodCommand, CommandGroups, type JsonEnvelope } from "../../../lib/oclif";

/** `auth-method password enable` (ADR 069). */
export default class AuthMethodPasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodPasswordEnable);
    return this.toggle(flags, "password", true);
  }
}
