import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { AuthMethodDisableCommand, providerKind } from "@/cli/commands/auth-method/command";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { UserSchema } from "@/lib/zitadel";
import { dryRunResult } from "@/cli/core/crud/shared";

/**
 * What a run that names no provider is refused for. The provider is always
 * named, because removing every provider at once would be a different, larger
 * change; the refusal lists the providers the schema offers, well-formed or
 * not.
 */
const NAME_PROVIDER_REFUSAL = {
  message: "Name the provider to remove",
  hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
} as const satisfies Refusal;

/**
 * `zitadel auth-method sso disable` — remove one provider from a schema
 * and from the login flows that run against it.
 *
 * The connection file and its published credentials are kept, so enabling the
 * provider again does not ask for them, and the server cannot delete a
 * connection yet anyway. The routes and steps `auth-method sso enable` added
 * stay in the flows too. The result says what was kept and how to remove what
 * can be removed today.
 */
export default class AuthMethodSsoDisable extends AuthMethodDisableCommand {
  static override description = "Remove an identity provider from a user schema.";
  static override group = CommandGroups.signIn;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> auth-method sso disable --provider google",
    "<%= config.bin %> auth-method sso disable --provider google --schema customers",
  ];
  static override flags = {
    provider: nonBlankString({ description: "Identity provider to remove." }),
  };

  /**
   * Says what removing the provider would change, without writing. The real
   * run is suggested exactly as the developer typed it, so it is one command
   * away. When only a flow still offered the provider, the title says so,
   * because the schema itself did not change.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({
    flags,
  }: Admitted<typeof AuthMethodSsoDisable>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);
    const config = target.config;
    const schema = target.schema;
    const provider = flags.provider ?? this.refuseUnnamedProvider(schema);
    this.annotate({ provider_type: providerKind(flags.provider) });
    const change = await this.previewIfNoSignInLeft(
      target,
      (options) => {
        return config.connections.disable(schema, provider, options);
      },
      { provider },
    );
    const edited = change.after.schemas.get(schema.path) ?? schema;
    const where = change.changedPaths.includes(schema.path)
      ? schema.name
      : `the login flows of ${schema.name}`;
    const data = {
      schema: schema.name,
      file: schema.path,
      method: "sso",
      provider: provider,
      changed: [...change.changedPaths],
      usable: [...edited.usableMethods],
      notices: change.notices,
    };

    this.report(change);
    const real = await this.realRun();
    const dryRun = dryRunResult({
      verb: "remove",
      topic: "provider",
      noun: provider,
      clause: `from ${where}`,
      next: real,
    });

    const title = change.changed
      ? dryRun.summary.title
      : escapeControlCharacters(
          `${schema.name} does not offer ${provider}, so nothing would change (dry run)`,
        );

    return {
      ...dryRun,
      pretty: undefined,
      data: {
        ...(dryRun.data as object),
        ...data,
        title,
        next_args: [this.argsOf(real)],
      },
      summary: {
        ...dryRun.summary,
        title,
        lines: this.said(change),
      },
    };
  }

  /**
   * Remove the provider from the schema and its login flows, asking first when it is the last way to sign in.
   * When only a flow still offered the provider, the result says so, because the
   * schema itself did not change.
   *
   * When nothing offers the connection any more, the result says how to remove
   * it: the file before the next deploy, and its variables once that deploy is
   * live. In the other order the live release would offer a provider whose
   * credentials are gone, and the deploy would refuse a connection whose
   * variables are missing. The `variable rm` commands carry the run's own
   * scope, so they reach the project this run named.
   *
   * @param input.flags - The provider, the schema and the environment flags.
   * @returns The result, with how to remove a connection nothing offers any more.
   * @throws {@link ZitadelError} When no provider is named, the schema cannot be
   *   chosen, or the change would leave no way to sign in and nobody agreed to it.
   */
  protected async apply({ flags }: Admitted<typeof AuthMethodSsoDisable>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);
    const config = target.config;
    const schema = target.schema;
    const provider = flags.provider ?? this.refuseUnnamedProvider(schema);
    this.annotate({ provider_type: providerKind(flags.provider) });
    const confirmed = await this.confirmIfNoSignInLeft(
      target,
      (options) => {
        return config.connections.disable(schema, provider, options);
      },
      { provider },
    );
    if (confirmed === undefined) {
      return this.cancelled("disable", [
        escapeControlCharacters(
          `${schema.path} is unchanged, so ${provider} is still offered to ${schema.name}.`,
        ),
      ]);
    }
    const change = confirmed.change;

    const edited = change.after.schemas.get(schema.path) ?? schema;
    const where = change.changedPaths.includes(schema.path)
      ? schema.name
      : `the login flows of ${schema.name}`;
    const data = {
      schema: schema.name,
      file: schema.path,
      method: "sso",
      provider: provider,
      changed: [...change.changedPaths],
      usable: [...edited.usableMethods],
      notices: change.notices,
    };
    const unchanged = `${schema.name} does not offer ${provider}, so nothing changed`;

    const written = await this.write(target, change, confirmed.consent);
    this.report(change);
    const followUps = this.followUps(change.changed);
    const unused = change.changed ? change.after.connections.findUnused(provider) : undefined;
    const unusedVariables =
      unused?.variables.map((name) => {
        return this.suggest({
          id: "variable:rm",
          args: { name },
        });
      }) ?? [];
    const actions =
      unused === undefined
        ? []
        : [
            `To stop publishing the connection, delete ${unused.connection.path} before the deploy below.`,
            ...(unusedVariables.length === 0
              ? []
              : [
                  `Once that deploy is live, remove its credentials: ${new Intl.ListFormat("en", { type: "conjunction" }).format(unusedVariables)}`,
                ]),
          ];

    const title = escapeControlCharacters(
      change.changed ? `Removed ${provider} from ${where}` : unchanged,
    );

    return {
      status: "ok",
      data: {
        ...data,
        title,
        next_args: followUps.args,
      },
      summary: {
        title,
        sections: [],
        lines: this.said(change, written),
      },
      next:
        actions.length > 0
          ? {
              actions,
              commands: followUps.commands,
            }
          : { commands: followUps.commands },
    };
  }

  /**
   * Refuse a run that names no provider. It is always named, because removing
   * every provider at once would be a different, larger change; the refusal
   * lists the providers the schema offers, well-formed or not.
   *
   * @param schema - The schema the run is about.
   * @returns Never: it always throws.
   * @throws {@link ZitadelError} Always, naming the providers the schema offers.
   */
  private refuseUnnamedProvider(schema: UserSchema): never {
    const offered = schema.providers.join(", ") || "none";
    throw refusalError(NAME_PROVIDER_REFUSAL, {
      example: IDP_PROVIDERS[0],
      schema: schema.name,
      offered,
    });
  }
}
