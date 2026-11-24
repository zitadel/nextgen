import { MethodDisableCommand } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";

/**
 * `zitadel auth-method passkey disable` — disable passkey sign-in for a user schema.
 */
export default class AuthMethodPasskeyDisable extends MethodDisableCommand {
  static override description = "Disable passkey sign-in for a user schema.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> auth-method passkey disable",
    "<%= config.bin %> auth-method passkey disable --schema customers",
  ];

  /**
   * The method this command turns off.
   */
  protected readonly method = "passkey";
}
