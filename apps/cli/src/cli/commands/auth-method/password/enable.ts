import { MethodEnableCommand } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";

/**
 * `zitadel auth-method password enable` — enable password sign-in for a user schema.
 */
export default class AuthMethodPasswordEnable extends MethodEnableCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];

  /**
   * The method this command turns on.
   */
  protected readonly method = "password";
}
