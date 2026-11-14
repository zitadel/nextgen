import {
  type ClientId,
  credentialVariables,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  idpProvider,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type Parsed,
  type ProviderName,
  type ProviderSelection,
  providerOf,
  RESERVED_SLUGS,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import { isDevelopmentBuild } from "@/lib/build-channel";
import {
  askConnectionEndpoints,
  callbackUriFor,
  loopbackIssuerWarning,
  ssoEnableFlags,
} from "@/lib/idp";
import { issuerFromPort } from "@/lib/orca";
import type { Questions } from "@/lib/ui";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import {
  askCustomSettings,
  type Fact,
  type PromptContext,
  type SetupAnswers,
  type SetupServices,
  type SsoDraft,
} from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
>;

/**
 * "Which external sign-in providers would you like to add?" — the one
 * onboarding question that needs something from outside the terminal, so it
 * asks last of the configuration questions and takes "not now" as a
 * first-class answer.
 *
 * Registering the OAuth application is the developer's to do and cannot be
 * automated, so the question announces what to register and where before
 * asking for anything back. Declining costs nothing: `auth-method sso enable`
 * performs exactly this journey on an existing Project, which is why this
 * prompt collects answers rather than doing any work — the scaffolding step
 * writes the connection, the schema and the flow in one place for both paths.
 * "Not now" stays an answer after a provider is ticked, too: the redirect URI
 * only shows once it is, and a developer who then finds they have no OAuth
 * application yet leaves the client id empty to drop that provider, rather
 * than cancelling setup and losing every answer.
 *
 * `--sso` skips only the parts it answers. A flagged run that could not
 * supply the secret — it is never a flag, and only a scripted run pipes it in
 * — is still asked for it here, the way `--preset` skips its own question and
 * no other. A flagged provider cannot be dropped: the command line asked for it.
 */
export class ChooseSocialSignIn extends WizardStep<"socialSignIn", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "socialSignIn";

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
   * Ask the question, or leave the answers as they are when nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, with this question's settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { app, flags, orca, scaffoldedFramework } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: await this.ask(needs.answers, {
        ask: this.deps.ask,
        note: (title, lines) => {
          this.deps.ui.note(title, lines);
        },
        say: (text) => {
          this.deps.ui.say(text);
        },
        spinner: (label, options) => {
          return this.deps.ui.spinner(label, options);
        },
        framework: {
          id: app.framework,
          displayName: orca.displayName(app.framework),
        },
        suggest: this.deps.suggest,
        cwd: this.deps.cwd,
        frameworkChosen: scaffoldedFramework || flags.framework !== undefined,
        serverFlag: this.deps.serverFlag,
        devPortFromFlag: flags.devPort !== undefined,
        presetFromFlag: flags.preset !== undefined,
        useCaseFromFlag: flags.useCase !== undefined,
        ssoFromFlag: flags.sso !== undefined,
        passwordMinLengthFromFlag: flags.passwordMinLength !== undefined,
        developmentBuild: isDevelopmentBuild(),
      }),
    };
  }

  /**
   * `--sso` names the set; the wizard asks for it only when no flag did.
   *
   * @remarks
   * Asked per provider rather than once: each registers its own OAuth application, so each has its
   * own console, its own client id and its own secret. A flagged run still gets asked for whatever
   * the flags left out.
   *
   * @param answers - The answers so far.
   * @param ctx - What the questions may need to know.
   * @returns The answers, with the chosen providers and their credentials.
   */
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    const chosen = ctx.ssoFromFlag
      ? answers.sso.map((draft) => {
          return selectionName(draft.selection);
        })
      : await this.chooseProviders(ctx.ask);
    if (chosen.length === 0) {
      return {
        ...answers,
        sso: [],
      };
    }
    return {
      ...answers,
      sso: await this.collect(chosen, answers, ctx),
    };
  }

  /**
   * Ask about each chosen provider in turn, and keep the ones whose credentials
   * were given.
   *
   * @remarks
   * Each provider is asked about after the one before it, because a person
   * answers one question at a time, so the rest are collected by the call that
   * follows.
   *
   * A custom connection is described before anything else about it can be said: the announcement
   * names its issuer, and its slug names the secret. One typed in here has not been through the
   * flag checks, and is described from scratch because nothing was given on the command line.
   *
   * The endpoints are asked before the announcement, which names the vendor's console: on a
   * development run (ZITADEL_CLI_DEV) the provider may not be the vendor at all. They are not asked
   * of a custom connection, whose issuer was just given.
   *
   * The announcement says what to register and where. The redirect URI is settled by now, because
   * the port question runs before this one and the issuer derives from it, so it can be shown
   * rather than left for the developer to work out, which matters because the vendor matches it
   * literally.
   *
   * The question says "to skip", not "to add it later": the line after it names the command that
   * adds it, and the shorter question fits an 80-column terminal. An empty client id drops the
   * provider, because a blank id is never a credential: the provider is either configured with both
   * values or not at all.
   *
   * @param names - The providers still to ask about.
   * @param answers - The answers so far.
   * @param ctx - What the questions may need to know.
   * @returns The providers with their credentials, skipped ones left out.
   */
  private async collect(
    names: readonly ProviderName[],
    answers: SetupAnswers,
    ctx: PromptContext,
  ): Promise<readonly SsoDraft[]> {
    const [name, ...rest] = names;
    if (name === undefined) {
      return [];
    }
    const flagged = answers.sso.find((draft) => {
      return selectionName(draft.selection) === name;
    });
    const selection: ProviderSelection =
      flagged?.selection ??
      (name === CUSTOM_PROVIDER
        ? {
            kind: "custom",
            connection: await askCustomSettings({}, ctx.ask).then((values) => {
              return {
                slug: validated(parseConnectionSlug(values.slug, RESERVED_SLUGS)),
                displayName: validated(parseDisplayName(values.displayName)),
                issuer: validated(parseIssuer(values.issuer)),
                scopes: validated(parseScopes(values.scopes)),
              };
            }),
          }
        : {
            kind: "catalog",
            id: name,
          });
    const loopback = flagged === undefined ? loopbackIssuerWarning(selection) : undefined;
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const entry = providerOf(selection);
    const endpoints =
      selection.kind === "custom"
        ? undefined
        : (flagged?.endpoints ??
          (await askConnectionEndpoints({
            provider: selection.id,
            developmentBuild: ctx.developmentBuild === true,
            ask: ctx.ask,
          })));
    ctx.note(`${entry.displayName} sign-in`, [
      ...(endpoints?.issuer === undefined
        ? [
            entry.consoleUrl === undefined
              ? `Register a client at ${entry.issuer}, as an OAuth application:`
              : "Register an OAuth application at:",
            ...(entry.consoleUrl === undefined ? [] : [entry.consoleUrl]),
          ]
        : ["Register a client with the provider at:", endpoints.issuer]),
      "",
      "Redirect URI:",
      callbackUriFor(issuerFromPort(answers.devPort), entry.slug),
    ]);
    const clientId = await ctx.ask.text({
      name: "client id",
      message:
        flagged === undefined
          ? `What is the client ID of your ${entry.displayName} OAuth app? Leave it empty to skip.`
          : `What is the client ID of your ${entry.displayName} OAuth app?`,
      parse:
        flagged === undefined
          ? (value: string): Parsed<ClientId | undefined> => {
              return value.trim() === ""
                ? {
                    ok: true,
                    value: undefined,
                  }
                : parseClientId(value);
            }
          : parseClientId,
      given: flagged?.credentials.clientId,
    });
    if (clientId === undefined) {
      ctx.say(
        [
          `Skipped ${entry.displayName}. Once its OAuth application exists, add it with:`,
          ctx.suggest({
            id: "auth-method:sso:enable",
            flags: ssoEnableFlags(selection),
          }),
        ].join("\n"),
      );
      return this.collect(rest, answers, ctx);
    }
    const secret =
      flagged?.credentials.secret ??
      (await ctx.ask.secret({
        name: "client secret",
        message: `What is the client secret of your ${entry.displayName} OAuth app? It will be stored on the project as ${credentialVariables(entry.slug).clientSecret}.`,
        parse: parseClientSecret,
      }));
    return [
      {
        selection,
        credentials: {
          clientId,
          secret,
        },
        endpoints,
        claimRequest: flagged?.claimRequest,
      },
      ...(await this.collect(rest, answers, ctx)),
    ];
  }

  /**
   * The providers to enable, empty when the developer wants none.
   *
   * @remarks
   * A multi-select rather than one choice: a project may offer several at
   * once, and the schema and flow already carry `sso_providers` as a list.
   * Space ticks a provider and Enter continues, so Enter on an empty list is
   * not a silent skip: it asks whether to go on without SSO, where No goes back
   * to the list by asking again, and only a Yes returns none.
   *
   * Nothing is preselected, and declining costs nothing: `auth-method sso enable`
   * performs this journey on an existing Project later.
   *
   * @param ask - The questions.
   * @returns The providers chosen.
   */
  private async chooseProviders(ask: Questions): Promise<readonly ProviderName[]> {
    const chosen = await ask.multiselect<ProviderName>({
      name: "external sign-in providers",
      message:
        "Which external sign-in providers would you like to add? Use Space to select and Enter to continue.",
      required: false,
      options: [
        ...IDP_PROVIDERS.map((provider) => {
          return {
            value: provider,
            label: `${idpProvider(provider).displayName} — requires a ${idpProvider(provider).displayName} OAuth app`,
          };
        }),
        {
          value: CUSTOM_PROVIDER,
          label: "Another OpenID Connect (OIDC) provider — requires provider configuration",
        },
      ],
    });
    if (chosen.length > 0) {
      return chosen;
    }
    const continueWithout = await ask.yesNo({
      name: "continue without SSO",
      message: "Would you like to continue without setting up SSO?",
      initialValue: false,
    });
    return continueWithout ? [] : this.chooseProviders(ask);
  }
}
