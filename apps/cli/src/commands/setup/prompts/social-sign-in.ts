import { note } from "@clack/prompts";

import {
  credentialVariables,
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  idpProvider,
  IDP_PROVIDERS,
  RESERVED_SLUGS,
  type IdpProvider,
  type Issuer,
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
  askConnectionEndpoints,
  askCustomSettings,
  callbackUriFor,
  loopbackIssuerWarning,
} from "../../../lib/idp";
import { clientIdQuestion, clientSecretQuestion } from "../../../lib/questions";
import { reportWarning } from "../../../lib/warnings";
import type { Asker } from "../../../lib/input";
import { issuerFromPort } from "../../../lib/orca";

import type { PromptContext, SetupAnswers, SetupPrompt, SsoDraft } from "./types";

/**
 * "Would you like to add external sign-in providers?" — the one onboarding question that needs
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
    // `--sso` names the set; the wizard asks for it only when no flag did.
    const chosen = ctx.ssoFromFlag
      ? answers.sso.map((draft) => selectionName(draft.selection))
      : await this.chooseProviders(ctx.input);
    if (chosen.length === 0) {
      return { ...answers, sso: [] };
    }

    // Asked per provider rather than once: each registers its own OAuth
    // application, so each has its own console, its own client id and its own
    // secret. A flagged run still gets asked for whatever the flags left out.
    const collected: SsoDraft[] = [];
    for (const name of chosen) {
      const flagged = answers.sso.find((draft) => selectionName(draft.selection) === name);
      // A custom connection is described before anything else about it can be
      // said: the announcement names its issuer, and its slug names the secret.
      const selection: ProviderSelection =
        flagged?.selection ??
        (name === CUSTOM_PROVIDER
          ? { kind: "custom", connection: await this.askCustom(ctx.input) }
          : { kind: "catalog", id: name });
      // A custom connection typed in here has not been through the flag checks.
      const loopback = flagged === undefined ? loopbackIssuerWarning(selection) : undefined;
      if (loopback !== undefined) {
        reportWarning(loopback);
      }
      const entry = providerOf(selection);
      // Before the announcement, which names the vendor's console: on a
      // development run (ZITADEL_CLI_DEV) the provider may not be the vendor at
      // all. Not asked of a custom connection, whose issuer was just given.
      const endpoints =
        selection.kind === "custom"
          ? undefined
          : (flagged?.endpoints ??
            (await askConnectionEndpoints({
              provider: selection.id,
              developmentBuild: ctx.developmentBuild === true,
              ask: ctx.input,
            })));
      this.announce(entry, answers.devPort, endpoints?.issuer);

      const clientId = await ctx.input({
        ...clientIdQuestion(entry.displayName),
        given: flagged?.credentials.clientId,
      });
      const secret = await ctx.input({
        ...clientSecretQuestion({
          provider: entry.displayName,
          variable: credentialVariables(providerOf(selection).slug).clientSecret,
        }),
        given: flagged?.credentials.secret,
      });
      collected.push({ selection, credentials: { clientId, secret }, endpoints });
    }
    return { ...answers, sso: collected };
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
      name: "external sign-in providers",
      message:
        "Would you like to add external sign-in providers? This is optional: select any you want, or press Enter to skip.",
      // Nothing preselected, and declining costs nothing:
      // `auth-method sso enable` performs this journey on an existing Project
      // later.
      required: false,
      options: [
        ...IDP_PROVIDERS.map((provider) => ({
          value: provider as ProviderName,
          label: `${idpProvider(provider).displayName} — requires a ${idpProvider(provider).displayName} OAuth app`,
        })),
        {
          value: CUSTOM_PROVIDER as ProviderName,
          label: "Another OpenID Connect (OIDC) provider — requires provider configuration",
        },
      ],
    });
  }

  /**
   * Say what to register and where. The redirect URI is settled by now — the
   * port question runs before this one and the issuer derives from it — so it
   * can be shown rather than left for the developer to work out, which
   * matters because the vendor matches it literally.
   */
  private announce(entry: IdpProvider, devPort: number, issuer?: Issuer): void {
    note(
      [
        // Where to register depends on who is actually answering: pointing a
        // developer at the vendor's console when the connection runs against
        // their own stand-in would be worse than saying nothing.
        ...(issuer === undefined
          ? [
              entry.consoleUrl === undefined
                ? `Register a client at ${entry.issuer}, as an OAuth application:`
                : "Register an OAuth application at:",
              ...(entry.consoleUrl === undefined ? [] : [entry.consoleUrl]),
            ]
          : ["Register a client with the provider at:", issuer]),
        "",
        "Redirect URI:",
        callbackUriFor(issuerFromPort(devPort), entry.slug),
      ].join("\n"),
      `${entry.displayName} sign-in`,
    );
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
