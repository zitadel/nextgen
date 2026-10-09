import { AuthMethodCommand, CommandGroups, type JsonEnvelope } from "../../../lib/oclif";

/** `auth-method passkey enable` (ADR 069). */
export default class AuthMethodPasskeyEnable extends AuthMethodCommand {
  static override description = "Enable passkey sign-in for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method passkey enable",
    "<%= config.bin %> auth-method passkey enable --schema customers",
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodPasskeyEnable);
    return this.toggle(flags, "passkey", true);
  }
}
