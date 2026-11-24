import { MethodEnableCommand } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";

/**
 * `zitadel auth-method passkey enable` — enable passkey sign-in for a user schema.
 */
export default class AuthMethodPasskeyEnable extends MethodEnableCommand {
  static override description = "Enable passkey sign-in for a user schema.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> auth-method passkey enable",
    "<%= config.bin %> auth-method passkey enable --schema customers",
  ];

  /**
   * The method this command turns on.
   */
  protected readonly method = "passkey";
}
