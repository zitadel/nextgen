import { multiselect, note, password, text } from "@clack/prompts";

import {
  credentialVariables,
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  DEFAULT_SCOPES,
  idpProvider,
  IDP_PROVIDERS,
  type IdpProvider,
  type Issuer,
  type Parsed,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseProviderSelection,
  parseScopes,
  type ProviderName,
  type ProviderSelection,
  providerOf,
  selectionName,
  selectionSlug,
  validated,
} from "@zitadel/config/idp";

import { askConnectionEndpoints, callbackUriFor } from "../../../lib/idp";
import { issuerFromPort } from "../../../lib/orca";

import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt, SsoDraft } from "./types";

/**
 * "Add social sign-in providers?" — the one onboarding question that needs
 * something from outside the terminal, so it asks last of the configuration
 * questions and takes "not now" as a first-class answer (#1081).
 *
 * Registering the OAuth application is the developer's to do and cannot be
 * automated, so the question announces what to register and where before
 * asking for anything back. Declining costs nothing: `sso enable` performs
 * exactly this journey on an existing Project, which is why this prompt
 * collects answers rather than doing any work — the scaffolding step writes
 * the connection, the schema and the flow in one place for both paths.
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
      : await this.chooseProviders();
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
      const selection = parseProviderSelection(
        name,
        name === CUSTOM_PROVIDER
          ? flagged?.selection.kind === "custom"
            ? flagged.selection.connection
            : await this.askCustom()
          : undefined,
      ) as ProviderSelection;
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
              command: "Setup",
            })));
      this.announce(entry, answers.devPort, endpoints?.issuer);

      const clientId =
        flagged?.credentials.clientId ??
        (await this.prompt(`Client ID (${entry.displayName})`, parseClientId));
      const secret =
        flagged?.credentials.secret ??
        (await this.prompt(
          `Client secret (published to the project as ${credentialVariables(selectionSlug(selection)).clientSecret})`,
          parseClientSecret,
          { secret: true },
        ));
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
  private async chooseProviders(): Promise<readonly ProviderName[]> {
    const chosen = await multiselect<ProviderName>({
      message: "Add social sign-in providers?",
      // Nothing preselected, and declining costs nothing: `sso enable`
      // performs this journey on an existing Project later.
      required: false,
      options: [
        ...IDP_PROVIDERS.map((provider) => ({
          value: provider,
          label: `Continue with ${idpProvider(provider).displayName}`,
          hint: "needs an OAuth app you register with the provider",
        })),
        {
          value: CUSTOM_PROVIDER,
          label: "Continue with another OpenID Connect provider",
          hint: "you name it and give its issuer",
        },
      ],
    });
    bail(chosen);
    return Array.isArray(chosen) ? chosen : [];
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
        callbackUriFor(issuerFromPort(devPort)),
      ].join("\n"),
      `${entry.displayName} sign-in`,
    );
  }

  /**
   * Describe a custom connection: what the developer calls it, what the button
   * says, where the provider is, and what to ask it for. Each answer is checked
   * against the contract the server enforces on apply, so a name or issuer it
   * would refuse is refused here, where it was typed.
   */
  private async askCustom(): Promise<CustomOidcInput> {
    return {
      slug: await this.prompt(
        "Name for this connection (used in your configuration, e.g. acme-sso)",
        (value) => parseConnectionSlug(value.trim(), IDP_PROVIDERS),
      ),
      displayName: await this.prompt(
        "Name shown on the sign-in button (e.g. Acme SSO)",
        parseDisplayName,
      ),
      issuer: await this.prompt("Issuer URL of the provider", parseIssuer),
      scopes: await this.prompt("Scopes to request", parseScopes, {
        initialValue: DEFAULT_SCOPES.join(" "),
      }),
    };
  }

  /**
   * One question whose answer must parse. The prompt shows what is wrong with
   * an answer as it is typed and does not accept one that does not parse, so
   * what comes back is the parsed value and not text to check again.
   *
   * Required, not skippable, which matters most for the credentials: by this
   * point the developer has chosen a provider and registered an OAuth
   * application for it, and a connection without the secret is a button that
   * fails at the provider with `invalid_client`, long after setup reported
   * success. "Not now" is answered by declining the provider, which costs
   * nothing — `sso enable` adds it later.
   */
  private async prompt<T>(
    message: string,
    parse: (value: string) => Parsed<T>,
    options: { readonly secret?: boolean; readonly initialValue?: string } = {},
  ): Promise<T> {
    const validate = (value: string | undefined) => {
      const parsed = parse(value ?? "");
      return parsed.ok ? undefined : parsed.problem;
    };
    const answer = options.secret
      ? await password({ message, validate })
      : await text({ message, validate, initialValue: options.initialValue });
    bail(answer);
    return validated(parse(String(answer)));
  }
}
