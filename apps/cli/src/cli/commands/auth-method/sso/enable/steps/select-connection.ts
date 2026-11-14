import {
  CUSTOM_PROVIDER,
  DEFAULT_SCOPES,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type ProviderSelection,
  providerOf,
  RESERVED_SLUGS,
} from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { customExample, ENABLE_FLAG_NAMES, selectionFromFlags } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "choice" | "target">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "dryRun">;

/**
 * Settles which provider the run adds, asking for what the flags left out of a
 * custom one.
 */
export class SelectConnection extends WizardStep<
  "selection",
  Fact<"selection" | "provider" | "options">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "selection";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Resolve the provider, asking a person for the custom settings the flags
   * left out.
   *
   * @remarks
   * A custom connection a person will be asked to finish is described only
   * once everything that can fail without an answer has passed. The slug comes
   * first because it decides the most: a connection that already has it answers
   * the rest from its file, and one that connects to another issuer, or that a
   * login flow would reject, is refused the moment the slug is typed. A given
   * value goes through the same parser as a typed one.
   *
   * An existing connection is described by its file, so nothing it already
   * holds is asked again. A setting the flags gave is not read from the file at
   * all, so a stored value it replaces is never refused. Reuse never applies
   * scopes, so a reused connection is not asked for them.
   *
   * @param needs - The flags, how they choose a provider, and what was read.
   * @returns The provider and the options the edit is made with.
   * @throws {@link ZitadelError} When a setting is refused.
   * @throws {@link ConfigError} When the slug names a connection that cannot
   *   be reused, or a flow would reject the provider.
   * @throws {@link NotOidcConnectionError} When the connection the slug names
   *   has no issuer, whatever issuer was given.
   * @throws {@link UnusableSettingError} When a stored setting the run would
   *   use cannot be used.
   */
  async run(needs: Needs): Promise<Fact<"selection" | "provider" | "options">> {
    if (needs.choice.selection !== undefined) {
      return this.settled(needs.choice.selection, needs);
    }
    const given = needs.choice.values;
    const slug = await this.deps.ask.text({
      name: "connection name",
      message:
        "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
      parse: (value) => {
        return parseConnectionSlug(value, RESERVED_SLUGS);
      },
      given: given.slug,
    });
    const parsedIssuer = given.issuer === undefined ? undefined : parseIssuer(given.issuer);
    const existing = needs.target.config.connections.resolveBySlug(
      slug,
      parsedIssuer?.ok ? parsedIssuer.value : undefined,
    );
    needs.target.config.flows.resolveForSso(needs.target.schema, slug);
    existing?.refuseNonOidc();
    const storedDisplayName =
      given.displayName === undefined ? existing?.readUsableDisplayName() : undefined;
    const storedIssuer = given.issuer === undefined ? existing?.readUsableIssuer() : undefined;
    const displayName = await this.deps.ask.text({
      name: "display name",
      message: "What name should the sign-in button show? For example Acme SSO.",
      parse: parseDisplayName,
      given: given.displayName ?? storedDisplayName,
    });
    const issuer = await this.deps.ask.text({
      name: "issuer",
      message: "What is the issuer URL of the provider?",
      parse: parseIssuer,
      given: given.issuer ?? storedIssuer,
    });
    const defaultScopes = DEFAULT_SCOPES.join(" ");
    const scopes = await this.deps.ask.text({
      name: "scopes",
      message: "Which scopes should we request? Separate them with spaces.",
      parse: parseScopes,
      given: given.scopes ?? (existing === undefined ? undefined : defaultScopes),
      initialValue: defaultScopes,
    });

    return this.settled(
      selectionFromFlags(
        CUSTOM_PROVIDER,
        {
          slug,
          displayName,
          issuer,
          scopes: scopes.join(" "),
        },
        ENABLE_FLAG_NAMES,
        customExample(ENABLE_FLAG_NAMES),
      ),
      needs,
    );
  }

  /**
   * The provider's facts and the options the edit is made with.
   *
   * @remarks
   * The settings the developer gave are the ones an existing connection may not
   * have: a custom connection's display name, and its scopes when `--scopes`
   * was passed. A catalog provider's settings are the catalog's.
   *
   * @param selection - The provider.
   * @param needs - The flags and how they choose a provider.
   * @returns The provider and the options the edit is made with.
   */
  private settled(
    selection: ProviderSelection,
    needs: Needs,
  ): Fact<"selection" | "provider" | "options"> {
    return {
      selection,
      provider: providerOf(selection),
      options: {
        clientId: needs.flags.clientId,
        given:
          selection.kind === "catalog"
            ? []
            : needs.choice.values.scopes === undefined
              ? ["display name"]
              : ["display name", "scopes"],
        dryRun: this.deps.dryRun,
      },
    };
  }
}
