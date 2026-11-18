import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, JsonEnvelope } from "@/lib/oclif";
import { action, type Observation } from "@/cli/telemetry/observation";

/**
 * `zitadel auth-method password enable` — enable password sign-in for a user schema.
 */
export default class AuthMethodPasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.signIn;
  static override readonly observation: Observation = {
    follow: action({
      action: "enable",
      resource_type: "authentication_method",
      method: "password",
      entry_point: "standalone",
    }),
  };
  static override groupOrder = 1;

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
