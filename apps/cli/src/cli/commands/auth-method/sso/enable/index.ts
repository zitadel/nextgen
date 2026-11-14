import { Flags } from "@oclif/core";
import {
  type ClientId,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  parseClientId,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  RESERVED_SLUGS,
} from "@zitadel/config/idp";

import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { errorMessage } from "@/lib/errors";
import {
  customExample,
  ENABLE_FLAG_NAMES,
  parseClaimEntry,
  parseScopeList,
  parseVerifiedEntry,
} from "@/lib/idp";
import { type Admitted, CommandGroups, type CommandResult, type JsonEnvelope } from "@/lib/oclif";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { accepts, parses } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { reportWarning } from "@/lib/warnings";
import { Wizard } from "@/lib/wizard";

import { AskClaims } from "./steps/ask-claims";
import { BuildChange } from "./steps/build-change";
import { ChooseProvider } from "./steps/choose-provider";
import { CollectCredentials } from "./steps/collect-credentials";
import { IntroduceProvider } from "./steps/introduce-provider";
import { LoadSchema } from "./steps/load-schema";
import { PlanChange } from "./steps/plan-change";
import { PreviewChange } from "./steps/preview-change";
import { PublishCredentials } from "./steps/publish-credentials";
import { ReadClaims } from "./steps/read-claims";
import { ReadIssuer } from "./steps/read-issuer";
import { ReadOrigins } from "./steps/read-origins";
import { SelectConnection } from "./steps/select-connection";
import { ShowResult } from "./steps/show-result";
import { WriteFiles } from "./steps/write-files";

/**
 * How a run that names no provider is refused. `--provider` is not oclif's
 * `required` so that its own refusal, which carries no hint, never answers
 * first; this one names the next move.
 */
const PROVIDER_IS_NAMED_REFUSAL = {
  message: "Name the provider to enable",
  hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
} as const satisfies Refusal;

/**
 * `zitadel auth-method sso enable` — add a provider to a Project's sign-in
 * methods.
 *
 * One direct journey: the developer is told what to register with the
 * provider, gives back the credentials, and the Project's configuration is
 * written. It works on the local Project `zitadel setup` created and does not
 * require claiming, because this is the local development path.
 *
 * The client secret never comes from a flag, following `variable set`: it is
 * prompted for, or read from stdin when scripting, so it cannot land in shell
 * history, a process listing, or CI logs.
 */
export default class AuthMethodSsoEnable extends AuthMethodCommand {
  static override description = "Add an identity provider to a user schema.";
  static override group = CommandGroups.authentication;

  static override examples = [
    "<%= config.bin %> auth-method sso enable --provider google",
    "<%= config.bin %> auth-method sso enable --provider google --schema customers",
    "<%= config.bin %> auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES)}`,
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES, true)} --client-id abc123 --non-interactive < secret.txt`,
  ];
  static override baseFlags = {
    ...AuthMethodCommand.baseFlags,
    ...environmentFlags,
  };
  static override flags = {
    provider: Flags.string({
      options: [...IDP_PROVIDERS, CUSTOM_PROVIDER],
      description: `Identity provider to enable, or "${CUSTOM_PROVIDER}" for a custom OpenID Connect (OIDC) provider.`,
    }),
    slug: Flags.custom<string>({
      parse: accepts(
        (value) => {
          return parseConnectionSlug(value, RESERVED_SLUGS);
        },
        { blankAsValue: true },
      ),
    })({
      description: "Name of the custom connection. Schemas and flows refer to it by this.",
    }),
    "display-name": Flags.custom<string>({
      parse: accepts(parseDisplayName, { blankAsValue: true }),
    })({
      description: "Name shown on the custom connection's sign-in button.",
    }),
    issuer: Flags.custom<string>({
      parse: accepts(parseIssuer, { blankAsValue: true }),
    })({
      description: "Issuer URL of the custom provider. Its endpoints are found by OIDC discovery.",
    }),
    scopes: Flags.custom<string>({
      parse: accepts(parseScopes, { blankAsValue: true }),
    })({
      description:
        "Scopes the custom connection requests, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
    "client-id": Flags.custom<ClientId>({
      parse: parses(parseClientId, {
        blankAsValue: true,
        refusal: {
          message: "{input} was given an empty value",
          hint: "Pass a value for {input}, or omit it entirely.",
        },
      }),
    })({
      description: "Client id of the application registered with the provider.",
    }),
    claim: Flags.custom<string>({
      multiple: true,
      parse: accepts(parseClaimEntry, { empty: AS_REFUSED }),
    })({
      description:
        "Fill a user-schema property from a provider claim: <property>=<claim>, e.g. staffNumber=employee_id:integer. A claim the provider returns as a number or boolean says so after a colon (string is the default). Repeatable. Given, it replaces the interactive claim questions; the standard claims whose names match the schema are mapped either way, and a claim you give replaces the default for its property.",
    }),
    "verified-claim": Flags.custom<string>({
      multiple: true,
      parse: accepts(parseVerifiedEntry, { empty: AS_REFUSED }),
    })({
      description:
        "Say how a mapped property is verified: <property>=<claim> names the boolean claim that must be true, <property>=true trusts the provider. Repeatable.",
    }),
    "claim-scope": Flags.custom<string>({
      parse: accepts(parseScopeList, { empty: AS_REFUSED }),
    })({
      description:
        "Extra scopes the mapped claims need before the provider returns them, separated by spaces or commas.",
    }),
  };

  static override meta = {
    resolveServer: true,
    environment: true,
  };

  /**
   * Add the provider to the schema and its login flows, and publish its
   * credentials to the project.
   *
   * @remarks
   * The steps run in the order they are added: read what the run is about,
   * work out the whole change and refuse what cannot be done, preview it or ask
   * for the credentials, then store them and write the files.
   *
   * @param input.flags - The provider, its settings, the schema and the environment flags.
   * @returns The result.
   * @throws {@link ZitadelError} When no provider is named, a setting is
   *   refused, the schema cannot be chosen, or no flow can offer the provider.
   */
  protected async execute({ flags }: Admitted<typeof AuthMethodSsoEnable>): Promise<JsonEnvelope> {
    if (flags.provider === undefined) {
      throw refusalError(PROVIDER_IS_NAMED_REFUSAL, {});
    }

    return this.emit(
      await Wizard.named<Fact<"flags">, CommandResult>("auth-method sso enable")
        .step(
          new ChooseProvider({
            dryRun: this.dryRun,
            nonInteractive: this.nonInteractive,
          }),
        )
        .step(
          new ReadIssuer({
            cwd: this.cwd,
            env: this.env,
          }),
        )
        .step(
          new LoadSchema({
            loadSchemaTarget: (input) => {
              return this.loadSchemaTarget(input);
            },
          }),
        )
        .step(
          new ReadOrigins({
            connect: () => {
              return this.connect();
            },
          }),
        )
        .step(
          new SelectConnection({
            ask: this.ask,
            dryRun: this.dryRun,
          }),
        )
        .step(new ReadClaims())
        .step(
          new PlanChange({
            ask: this.ask,
            developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
            suggest: this.suggest,
          }),
        )
        .step(new IntroduceProvider())
        .endWhen(
          new PreviewChange({
            argsOf: (command) => {
              return this.argsOf(command);
            },
            dryRun: this.dryRun,
            isJson: this.isJson,
            realRun: () => {
              return this.realRun();
            },
            report: (change) => {
              this.report(change);
            },
          }),
        )
        .step(new CollectCredentials())
        .step(
          new AskClaims({
            ask: this.ask,
            nonInteractive: this.nonInteractive,
          }),
        )
        .step(new BuildChange())
        .step(
          new PublishCredentials({
            signal: this.signal,
            source: this.meta.source,
          }),
        )
        .step(
          new WriteFiles({
            report: (change) => {
              this.report(change);
            },
            write: (target, change) => {
              return this.write(target, change, undefined);
            },
          }),
        )
        .step(
          new ShowResult({
            followUps: (changed, leading) => {
              return this.followUps(changed, leading);
            },
            isJson: this.isJson,
            suggest: this.suggest,
          }),
        )
        .finish((state) => {
          return state.answer;
        })
        .run(
          { flags },
          {
            onUndoError: (key, error) => {
              reportWarning(`Could not take back the ${key} step: ${errorMessage(error)}`);
            },
          },
        ),
    );
  }
}
