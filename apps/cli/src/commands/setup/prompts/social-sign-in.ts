import {
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  DEFAULT_SCOPES,
  idpProvider,
  IDP_PROVIDERS,
  RESERVED_SLUGS,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type ProviderName,
  type ProviderSelection,
  providerOf,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import {
  applyRequest,
  asksForClaims,
  askClaims,
  claimsOrRefuse,
  askConnectionEndpoints,
  callbackUriFor,
  type CustomFlagValues,
  CONNECTION_SCHEMA_REF,
  loopbackIssuerWarning,
  registrationLines,
  seedMapping,
} from "../../../lib/idp";
import { defaultSchemaAttributes } from "../../../lib/setup-resources";
import { reportWarning } from "../../../lib/warnings";
import type { Asker } from "../../../lib/input";
import { issuerFromPort } from "../../../lib/orca";
import { Wizard } from "../../../lib/wizard";

import type { PromptContext, SetupAnswers, SetupPrompt, SsoDraft } from "./types";

/**
 * The settings of a custom connection, asking only for the ones not already
 * given — the way `--preset` skips its own question and no other. A given
 * value goes through the same parser as a typed one, so every setting comes
 * back checked against the contract the server enforces on apply, and a name
 * or issuer it would refuse is refused. The command line's own mistakes are
 * named under their flag before this runs (`checkGivenCustomFlags`), so a
 * given value that gets here has already passed.
 */
export async function askCustomSettings(
  given: CustomFlagValues,
  ask: Asker,
): Promise<Required<CustomFlagValues>> {
  const slug = await ask({
    kind: "text",
    name: "connection name",
    message: "What should this connection be called?",
    placeholder: "acme-sso",
    parse: (value) => parseConnectionSlug(value, RESERVED_SLUGS),
    given: given.slug,
  });
  const displayName = await ask({
    kind: "text",
    name: "display name",
    message: "What should the sign-in button say?",
    placeholder: "Acme SSO",
    parse: parseDisplayName,
    given: given.displayName,
  });
  const issuer = await ask({
    kind: "text",
    name: "issuer",
    message: "What is the provider's issuer URL?",
    placeholder: "https://sso.acme.example",
    parse: parseIssuer,
    given: given.issuer,
  });
  const scopes = await ask({
    kind: "text",
    name: "scopes",
    message: `Which scopes should "${displayName}" be asked for?`,
    parse: parseScopes,
    given: given.scopes,
    initialValue: DEFAULT_SCOPES.join(" "),
  });
  // The settings carry the scopes as the one string a flag does.
  return { slug, displayName, issuer, scopes: scopes.join(" ") };
}

/**
 * "Add sign-in with another service?" — the one onboarding question that needs
 * something from outside the terminal, so it asks last of the configuration
 * questions and takes "not now" as a first-class answer (#1081).
 *
 * Registering the OAuth application is the developer's to do and cannot be
 * automated, so the question announces what to register and where before
 * asking for anything back. Declining costs nothing: `auth-method sso enable`
 * performs exactly this journey on an existing Project, which is why this
 * prompt collects answers rather than doing any work — the scaffolding step
 * writes the connection, the schema and the flow in one place for both paths.
 *
 * `--sso` skips only the parts it answers. A flagged run that could not
 * supply the secret — it is never a flag, and only a scripted run pipes it in
 * — is still asked for it here, the way `--preset` skips its own question and
 * no other.
 */
export class SocialSignInPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    const wizard = new Wizard({ ask: ctx.input, output: ctx.wizardOutput });
    // `--sso` names the set; the wizard asks for it only when no flag did.
    const chosen = ctx.ssoFromFlag
      ? answers.sso.map((draft) => selectionName(draft.selection))
      : await this.chooseProviders(wizard.ask);
    if (chosen.length === 0) {
      return { ...answers, sso: [] };
    }

    // Asked per provider rather than once: each registers its own OAuth
    // application, so each has its own console, its own client id and its own
    // secret. A flagged run still gets asked for whatever the flags left out.
    // Each provider is a branch of the wizard, so its questions read together.
    const collected: SsoDraft[] = [];
    for (const name of chosen) {
      const flagged = answers.sso.find((draft) => selectionName(draft.selection) === name);
      const title =
        name === CUSTOM_PROVIDER ? "Configuring the new provider" : idpProvider(name).displayName;
      collected.push(
        await wizard.branch(title, () => this.askProvider(wizard, name, flagged, answers, ctx)),
      );
    }
    return { ...answers, sso: collected };
  }

  /** One provider's questions, in the order a person can answer them. */
  private async askProvider(
    wizard: Wizard,
    name: ProviderName,
    flagged: SsoDraft | undefined,
    answers: SetupAnswers,
    ctx: PromptContext,
  ): Promise<SsoDraft> {
    // A custom connection is described before anything else about it can be
    // said: the registration message names its issuer, and its slug names the
    // secret.
    const selection: ProviderSelection =
      flagged?.selection ??
      (name === CUSTOM_PROVIDER
        ? { kind: "custom", connection: await this.askCustom(wizard.ask) }
        : { kind: "catalog", id: name });
    // A custom connection typed in here has not been through the flag checks.
    const loopback = flagged === undefined ? loopbackIssuerWarning(selection) : undefined;
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const entry = providerOf(selection);
    // Before the registration message, which names the vendor's console: on a
    // development run (ZITADEL_CLI_DEV) the provider may not be the vendor at
    // all. Not asked of a custom connection, whose issuer was just given.
    const endpoints =
      selection.kind === "custom"
        ? undefined
        : (flagged?.endpoints ??
          (await askConnectionEndpoints({
            provider: selection.id,
            developmentBuild: ctx.developmentBuild === true,
            ask: wizard.ask,
          })));

    // Flags are held to the schema now, before anything is typed: the check
    // that runs when the connection is built comes after the credentials, and
    // a mistake in the command line should not cost them.
    const attributes = defaultSchemaAttributes(answers.preset, answers.useCase);
    const seeded = seedMapping(
      entry.connection({
        schemaProperties: attributes.map((one) => one.name),
        schemaRef: CONNECTION_SCHEMA_REF,
        endpoints,
      }),
      attributes,
    );
    const given = flagged?.claims;
    if (given !== undefined && asksForClaims(given)) {
      claimsOrRefuse(applyRequest(seeded, given), "");
    }

    // Said where the person needs it: just before they are asked for what
    // registering the application gives them. The redirect URI is settled by
    // now, and the vendor matches it literally.
    wizard.say(
      registrationLines(
        entry,
        callbackUriFor(issuerFromPort(answers.devPort), entry.slug),
        endpoints?.issuer,
      ),
    );
    const clientId = await wizard.ask({
      kind: "text",
      name: "client id",
      message: "What is the OAuth client ID?",
      parse: parseClientId,
      given: flagged?.credentials.clientId,
    });
    const secret = await wizard.ask({
      kind: "secret",
      name: "client secret",
      message: "What is the OAuth client secret?",
      parse: parseClientSecret,
      given: flagged?.credentials.secret,
    });

    // `--sso-claim` is the whole answer when given.
    const claims =
      given !== undefined && asksForClaims(given)
        ? given
        : await askClaims(seeded, wizard, entry.displayName);
    wizard.say(`"${entry.displayName}" is set up.`, "success");
    return { selection, credentials: { clientId, secret }, endpoints, claims };
  }

  /**
   * The providers to enable, empty when the developer wants none.
   *
   * A multi-select rather than one choice: a project may offer several at
   * once, and the schema and flow already carry `sso_providers` as a list.
   * `required: false` is what makes "none" an answer -- an explicit "not now"
   * option cannot coexist with ticking a provider beside it.
   */
  private async chooseProviders(ask: Asker): Promise<readonly ProviderName[]> {
    return ask({
      kind: "multiselect",
      name: "social sign-in providers",
      message: "Add sign-in with another service?",
      // Nothing preselected, and declining costs nothing:
      // `auth-method sso enable` performs this journey on an existing Project
      // later.
      required: false,
      options: [
        ...IDP_PROVIDERS.map((provider) => ({
          value: provider as ProviderName,
          label: idpProvider(provider).displayName,
          hint: "needs an OAuth application you create there",
        })),
        {
          value: CUSTOM_PROVIDER as ProviderName,
          label: "Another OpenID Connect provider",
          hint: "you give its issuer",
        },
      ],
    });
  }

  /** Describe a custom connection from scratch: nothing was given on the command line. */
  private async askCustom(ask: Asker): Promise<CustomOidcInput> {
    const values = await askCustomSettings({}, ask);
    return {
      slug: validated(parseConnectionSlug(values.slug, RESERVED_SLUGS)),
      displayName: validated(parseDisplayName(values.displayName)),
      issuer: validated(parseIssuer(values.issuer)),
      scopes: validated(parseScopes(values.scopes)),
    };
  }
}
