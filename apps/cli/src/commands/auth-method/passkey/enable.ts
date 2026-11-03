import {
  type Admitted,
  AuthMethodCommand,
  CommandGroups,
  type JsonEnvelope,
} from "../../../lib/oclif";

/** `auth-method passkey enable` (ADR 070). */
export default class AuthMethodPasskeyEnable extends AuthMethodCommand {
  static override description = "Enable passkey sign-in for a user schema.";
  static override group = CommandGroups.authentication;
  static override examples = [
    "<%= config.bin %> auth-method passkey enable",
    "<%= config.bin %> auth-method passkey enable --schema customers",
  ];

  protected async execute({
    target,
  }: Admitted<typeof AuthMethodPasskeyEnable>): Promise<JsonEnvelope> {
    return this.toggle(target, "passkey", true);
  }
}
