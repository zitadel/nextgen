import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

/**
 * `zitadel auth-method password enable` — enable password sign-in for a user schema.
 */
export default class AuthMethodPasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.authentication;

  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];

  /**
   * Turn the method on or off for the schema `--schema` names.
   *
   * @param input.flags - The run's `--schema` and `--cwd`.
   * @returns The result.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or the change
   *   would leave no way to sign in and nobody agreed to it.
   */
  protected async execute({
    flags,
  }: Admitted<typeof AuthMethodPasswordEnable>): Promise<JsonEnvelope> {
    return this.toggle(flags, "password", true);
  }
}
