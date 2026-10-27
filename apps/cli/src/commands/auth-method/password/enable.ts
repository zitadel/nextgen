import { AuthMethodCommand, CommandGroups, type JsonEnvelope } from "../../../lib/oclif";

/** `auth-method password enable` (ADR 070). */
export default class AuthMethodPasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.authentication;

  static override heading = "Enabling password sign-in";

  static override summarises = true;
  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodPasswordEnable);
    return this.toggle(flags, "password", true);
  }
}
