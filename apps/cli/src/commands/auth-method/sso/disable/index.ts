import { Flags } from "@oclif/core";
import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { AuthMethodCommand, type SchemaTarget } from "@/commands/auth-method/command";
import { type Admitted, CommandGroups, type JsonEnvelope, nonBlankString } from "@/lib/oclif";
import { environmentSelectorSuffix } from "@/lib/oclif/environment-flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { prose } from "@/lib/oclif/rendering";
import { optionArgs } from "@/lib/public-cli";
import { projectCommand } from "@/lib/suggestion";
import type { Change } from "@/lib/zitadel";

/** What a run that names no provider is refused for. */
const NAME_PROVIDER_REFUSAL: Refusal = {
  message: "Name the provider to remove",
  hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
};

/**
 * The provider to remove. It is always named, because removing every provider
 * at once would be a different, larger change; the refusal lists the providers
 * the schema offers, well-formed or not.
 */
export function providerToRemove(given: string | undefined, target: SchemaTarget): string {
  if (given !== undefined) {
    return given;
  }
  throw refusalError(NAME_PROVIDER_REFUSAL, {
    example: IDP_PROVIDERS[0],
    schema: target.schema.name,
    offered: target.schema.providers.join(", ") || "none",
  });
}

/**
 * `auth-method sso disable` (ADR 070 §2): remove one provider from a schema
 * and from the login flows that run against it.
 *
 * The connection file and its published credentials are kept, so enabling the
 * provider again does not ask for them, and the server cannot delete a
 * connection yet anyway. The routes and steps `auth-method sso enable` added
 * stay in the flows too. The result says what was kept and how to remove what
 * can be removed today.
 */
export default class AuthMethodSsoDisable extends AuthMethodCommand {
  static override description = "Remove an identity provider from a user schema.";
  static override group = CommandGroups.authentication;
  static override examples = [
    "<%= config.bin %> auth-method sso disable --provider google",
    "<%= config.bin %> auth-method sso disable --provider google --schema customers",
  ];
  static override flags = {
    provider: nonBlankString({ description: "Identity provider to remove." }),
    // `--force` is per command, not global (ADR 064 §10): here it permits
    // removing the last way to sign in, which the server allows for a schema
    // whose users are only managed through the API.
    force: Flags.boolean({
      char: "f",
      description:
        "Disable the schema's last way to sign in. Its users can then only be managed through the API.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof AuthMethodSsoDisable>): Promise<JsonEnvelope> {
    const target = await this.schemaTarget(flags);
    const { config, schema } = target;
    const provider = providerToRemove(flags.provider, target);
    const retryArgs = [
      "auth-method",
      "sso",
      "disable",
      ...optionArgs("--provider", provider),
      ...optionArgs("--schema", target.schemaFlag),
    ];
    const change = await this.confirmIfNoSignInLeft(target, retryArgs, (options) => {
      return config.disableSso(schema, provider, options);
    });
    if (change === undefined) {
      return this.emit({
        status: "skipped",
        reason: "disable-cancelled",
      });
    }

    const edited = change.after.schema(schema.path) ?? schema;
    // When only a flow still offered the provider, say so: the schema itself
    // did not change.
    const where = change.changedPaths.includes(schema.path)
      ? schema.name
      : `the login flows of ${schema.name}`;
    const unchanged = `${schema.name} does not offer ${provider}, so nothing changed`;
    const data = {
      schema: schema.name,
      file: schema.path,
      method: "sso",
      provider,
      changed: [...change.changedPaths],
      usable: [...edited.usableMethods],
      notices: change.notices,
    };

    if (this.dryRun) {
      this.report(change);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty: prose(change.changed ? `Would remove ${provider} from ${where}` : unchanged),
      });
    }
    await this.write(target, change);
    this.report(change);
    const followUps = this.followUps(change.changed, target.cwdArgs);
    const actions = this.removalActions(change, provider, flags);

    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { ...(actions.length > 0 ? { actions } : {}), commands: followUps.commands },
      pretty: prose(change.changed ? `Removed ${provider} from ${where}` : unchanged),
    });
  }

  /**
   * How to remove the connection, once nothing offers its provider: the file
   * before the next deploy, and its variables once that deploy is live. In the
   * other order the live release would offer a provider whose credentials are
   * gone, and the deploy would refuse a connection whose variables are
   * missing. The `variable rm` commands carry the run's
   * `--env`/`--env-file`/`--server`, so they reach the project this run named.
   */
  private removalActions(
    change: Change,
    provider: string,
    flags: { cwd?: string; env?: string; envFile?: string; server?: string },
  ): string[] {
    const connection = change.after.connection(provider);
    if (
      !change.changed ||
      connection === undefined ||
      change.after.offeredBy(provider).length > 0
    ) {
      return [];
    }
    const deletion = `To stop publishing the connection, delete ${connection.path} before the deploy below.`;
    const variables = change.after.unsharedVariables(connection);
    if (variables.length === 0) {
      return [deletion];
    }
    const selector = environmentSelectorSuffix({
      cwd: flags.cwd,
      envFile: flags.envFile,
      envName: flags.env,
      server: flags.server,
    });
    const commands = variables.map((name) => {
      return `\`${projectCommand(`variable rm ${name}`, selector, this.cliVersion)}\``;
    });
    return [
      deletion,
      `Once that deploy is live, remove its credentials: ${commands.join(" and ")}`,
    ];
  }
}
