import { Flags } from "@oclif/core";
import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { CANCELLED } from "@/lib/errors";
import { type Admitted, CommandGroups, type JsonEnvelope, nonBlankString } from "@/lib/oclif";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { UnusedConnection, UserSchema } from "@/lib/zitadel";

/**
 * What a run that names no provider is refused for. The provider is always
 * named, because removing every provider at once would be a different, larger
 * change; the refusal lists the providers the schema offers, well-formed or
 * not.
 */
const NAME_PROVIDER_REFUSAL: Refusal = {
  message: "Name the provider to remove",
  hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
};

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

  /**
   * Remove the provider from the schema and its login flows.
   *
   * @param input.flags - The provider, the schema and the environment flags.
   * @returns The result, with how to remove a connection nothing offers any more.
   * @throws {@link ZitadelError} When no provider is named, the schema cannot be
   *   chosen, or the change would leave no way to sign in and nobody agreed to it.
   */
  protected async execute({ flags }: Admitted<typeof AuthMethodSsoDisable>): Promise<JsonEnvelope> {
    const target = await this.loadSchemaTarget(flags);
    const config = target.config;
    const schema = target.schema;
    const provider = flags.provider ?? this.refuseUnnamedProvider(schema);
    const confirmed = await this.confirmIfNoSignInLeft(
      target,
      (options) => {
        return config.connections.disable(schema, provider, options);
      },
      { provider },
    );
    if (confirmed === undefined) {
      return this.emit({
        status: "skipped",
        reason: "disable-cancelled",
        summary: {
          title: CANCELLED,
          sections: [],
          lines: [
            escapeControlCharacters(
              `${schema.path} is unchanged, so ${provider} is still offered to ${schema.name}.`,
            ),
          ],
        },
      });
    }
    const change = confirmed.change;

    const edited = change.after.schemas.get(schema.path) ?? schema;
    // When only a flow still offered the provider, say so: the schema itself
    // did not change.
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

    if (this.dryRun) {
      this.report(change);
      const wouldTitle = escapeControlCharacters(
        change.changed
          ? `Would remove ${provider} from ${where} (dry run)`
          : `${schema.name} does not offer ${provider}, so nothing would change (dry run)`,
      );
      // What the developer typed, so the real run is one command away.
      const real = await this.realRun();

      return this.emit({
        status: "ok",
        data: {
          ...data,
          title: wouldTitle,
          dry_run: true,
          next_args: [this.argsOf(real)],
        },
        summary: {
          title: wouldTitle,
          sections: [],
        },
        next: { commands: [real] },
      });
    }
    await this.write(target, change, confirmed.consent);
    this.report(change);
    const followUps = this.followUps(change.changed);
    const unused = change.changed ? change.after.connections.findUnused(provider) : undefined;
    const actions = unused === undefined ? [] : this.removalActions(unused);

    const title = escapeControlCharacters(
      change.changed ? `Removed ${provider} from ${where}` : unchanged,
    );

    return this.emit({
      status: "ok",
      data: {
        ...data,
        title,
        next_args: followUps.args,
      },
      summary: {
        title,
        sections: [],
      },
      next:
        actions.length > 0
          ? {
              actions,
              commands: followUps.commands,
            }
          : { commands: followUps.commands },
    });
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

  /**
   * How to remove a connection nothing offers any more: the file before the
   * next deploy, and its variables once that deploy is live.
   *
   * @remarks
   * In the other order the live release would offer a provider whose
   * credentials are gone, and the deploy would refuse a connection whose
   * variables are missing. The `variable rm` commands carry the run's own
   * scope, so they reach the project this run named.
   *
   * @param unused - The connection, and the variables only it reads.
   * @returns The actions, the file's deletion first.
   */
  private removalActions(unused: UnusedConnection): readonly string[] {
    const deletion = `To stop publishing the connection, delete ${unused.connection.path} before the deploy below.`;
    if (unused.variables.length === 0) {
      return [deletion];
    }
    const commands = unused.variables.map((name) => {
      return this.suggest({ id: "variable:rm", args: { name } });
    });
    return [
      deletion,
      `Once that deploy is live, remove its credentials: ${new Intl.ListFormat("en", { type: "conjunction" }).format(commands)}`,
    ];
  }
}
