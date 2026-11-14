import { errorMessage } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";
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
  validated,
} from "@zitadel/config/idp";

import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { isDevelopmentBuild } from "@/lib/build-channel";
import {
  customExample,
  ENABLE_FLAG_NAMES,
  parseClaimEntry,
  parseScopeList,
  parseVerifiedEntry,
} from "@/lib/idp";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { accepts, AS_REFUSED, filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";

import { Wizard } from "@/lib/wizard";

import { AskClaims } from "./steps/ask-claims";
import { BuildChange } from "./steps/build-change";
import { ChooseProvider } from "./steps/choose-provider";
import { CollectCredentials } from "./steps/collect-credentials";
import { developmentIssuer, ReadIssuer } from "./steps/read-issuer";
import { IntroduceProvider } from "./steps/introduce-provider";
import { PlanChange } from "./steps/plan-change";
import { PreviewChange } from "./steps/preview-change";
import { PublishCredentials } from "./steps/publish-credentials";
import { ReadClaims } from "./steps/read-claims";
import { ReadOrigins } from "./steps/read-origins";
import { ShowResult } from "./steps/show-result";
import { SelectConnection } from "./steps/select-connection";
import type { EnableAnswer, EnableInput } from "./shared";
import { LoadSchema } from "./steps/load-schema";
import { WriteFiles } from "./steps/write-files";

/**
 * The client id a value holds, trimmed as the one a prompt would have
 * accepted. Refuses a blank value, naming the flag; `parseClientId` then
 * blesses what is left as one the provider could have issued.
 */
const CLIENT_ID = {
  schema: filled.transform((id) => {
    return validated(parseClientId(id));
  }),
  refusal: {
    message: "{input} was given an empty value",
    hint: "Pass a value for {input}, or omit it entirely.",
  },
} as const satisfies Refused<ClientId>;

/**
 * How a run that names no provider is refused. `--provider` is not oclif's
 * `required` so that its own refusal, which carries no hint, never answers
 * first; this one names the next move.
 */
const PROVIDER_IS_NAMED_REFUSAL = {
  message: "Name the provider to enable",
  hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
} as const satisfies Refusal;

export { developmentIssuer };

/**
 * The flags the command admitted, which every step reads what it needs from.
 */
export type EnableFlags = Admitted<typeof AuthMethodSsoEnable>["flags"];

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
        { empty: AS_REFUSED },
      ),
    })({
      description: "Name of the custom connection. Schemas and flows refer to it by this.",
    }),
    "display-name": Flags.custom<string>({
      parse: accepts(parseDisplayName, { empty: AS_REFUSED }),
    })({
      description: "Name shown on the custom connection's sign-in button.",
    }),
    issuer: Flags.custom<string>({
      parse: accepts(parseIssuer, { empty: AS_REFUSED }),
    })({
      description: "Issuer URL of the custom provider. Its endpoints are found by OIDC discovery.",
    }),
    scopes: Flags.custom<string>({
      parse: accepts(parseScopes, { empty: AS_REFUSED }),
    })({
      description:
        "Scopes the custom connection requests, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
    "client-id": Flags.custom<ClientId>({
      parse: reads(CLIENT_ID),
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
      await this.wizard().run(
        { flags },
        {
          signal: this.signal,
          onUndoError: (key, error) => {
            reportWarning(`Could not take back the ${key} step: ${errorMessage(error)}`);
          },
        },
      ),
    );
  }

  /**
   * The steps of `auth-method sso enable`, in the order they run: read what the
   * run is about, work out the whole change and refuse what cannot be done,
   * preview it or ask for the credentials, then store them and write the files.
   *
   * @returns The wizard, ready to run.
   */
  private wizard() {
    return Wizard.named<EnableInput, EnableAnswer>("auth-method sso enable")
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
          loadSchemaTarget: (flags) => {
            return this.loadSchemaTarget(flags);
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
      });
  }
}
