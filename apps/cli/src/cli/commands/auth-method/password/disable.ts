import { MethodDisableCommand } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";

/**
 * `zitadel auth-method password disable` — disable password sign-in for a user schema.
 */
export default class AuthMethodPasswordDisable extends MethodDisableCommand {
  static override description = "Disable password sign-in for a user schema.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> auth-method password disable",
    "<%= config.bin %> auth-method password disable --schema customers",
  ];

  /**
   * The method this command turns off.
   */
  protected readonly method = "password";
}
