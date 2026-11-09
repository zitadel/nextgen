import { AuthMethodCommand } from "@/commands/auth-method/command";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

/** `auth-method password enable` (ADR 070). */
export default class AuthMethodPasswordEnable extends AuthMethodCommand {
  static override description = "Enable password sign-in for a user schema.";
  static override group = CommandGroups.authentication;

  static override heading = "Enabling password sign-in";
  static override examples = [
    "<%= config.bin %> auth-method password enable",
    "<%= config.bin %> auth-method password enable --schema customers",
  ];

  protected async execute({
    flags,
  }: Admitted<typeof AuthMethodPasswordEnable>): Promise<JsonEnvelope> {
    return this.toggle(await this.schemaTarget(flags), "password", true);
  }
}
