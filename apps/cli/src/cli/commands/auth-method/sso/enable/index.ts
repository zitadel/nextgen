import { errorMessage } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";
import { Flags } from "@oclif/core";
import {
  type ClientId,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  parseClientId,
  parseConnectionSlug,
  type Parsed,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  RESERVED_SLUGS,
  validated,
} from "@zitadel/config/idp";
import { z } from "zod";

import { AuthMethodCommand } from "@/cli/commands/auth-method/command";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { customExample, ENABLE_FLAG_NAMES } from "@/lib/idp";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";

import { Wizard } from "@/lib/wizard";

import { BuildChange } from "./steps/build-change";
import { ChooseProvider } from "./steps/choose-provider";
import { CollectCredentials } from "./steps/collect-credentials";
import { developmentIssuer, ReadIssuer } from "./steps/read-issuer";
import { IntroduceProvider } from "./steps/introduce-provider";
import { PlanChange } from "./steps/plan-change";
import { PreviewChange } from "./steps/preview-change";
import { PublishCredentials } from "./steps/publish-credentials";
import { ReadOrigins } from "./steps/read-origins";
import { ShowResult } from "./steps/show-result";
import { SelectConnection } from "./steps/select-connection";
import type { EnableAnswer, EnableInput, EnableServices } from "./shared";
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
 * One of the settings that describe a custom connection, refused with what
 * the platform's own parser found wrong with it.
 *
 * @remarks
 * The flag names itself in the refusal, because a run gives four of them and
 * the complaint belongs to one. `setup` declares the same settings under its
 * own `--sso-*` names.
 *
 * @param flag - The flag, as the command spells it.
 * @param parse - The platform's parser for the setting.
 * @returns The flag's definition, waiting for its description.
 */
function settingFlag(flag: string, parse: (value: string) => Parsed<unknown>) {
  return Flags.custom<string>({
    parse: reads({
      schema: filled.transform((value, ctx) => {
        const parsed = parse(value);
        if (!parsed.ok) {
          ctx.addIssue({
            code: "custom",
            message: parsed.problem,
          });
          return z.NEVER;
        }
        return value;
      }),
      refusal: {
        message: `${flag}: {problem}`,
        hint: `Fix ${flag} and run the command again.`,
        details: {
          flag,
        },
      },
    }),
  });
}

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
    slug: settingFlag("--slug", (value) => {
      return parseConnectionSlug(value, RESERVED_SLUGS);
    })({
      description: "Name of the custom connection. Schemas and flows refer to it by this.",
    }),
    "display-name": settingFlag(
      "--display-name",
      parseDisplayName,
    )({
      description: "Name shown on the custom connection's sign-in button.",
    }),
    issuer: settingFlag(
      "--issuer",
      parseIssuer,
    )({
      description: "Issuer URL of the custom provider. Its endpoints are found by OIDC discovery.",
    }),
    scopes: settingFlag(
      "--scopes",
      parseScopes,
    )({
      description:
        "Scopes the custom connection requests, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
    "client-id": Flags.custom<ClientId>({
      parse: reads(CLIENT_ID),
    })({
      description: "Client id of the application registered with the provider.",
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

    return this.wizard().run(
      this.services(),
      { flags },
      {
        signal: this.signal,
        onUndoError: (key, error) => {
          reportWarning(`Could not take back the ${key} step: ${errorMessage(error)}`);
        },
      },
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
    return Wizard.named<EnableServices, EnableInput, EnableAnswer>("auth-method sso enable")
      .step(new ChooseProvider())
      .step(new ReadIssuer())
      .step(new LoadSchema())
      .step(new ReadOrigins())
      .step(new SelectConnection())
      .step(new PlanChange())
      .step(new IntroduceProvider())
      .endWhen(new PreviewChange())
      .step(new CollectCredentials())
      .step(new BuildChange())
      .step(new PublishCredentials())
      .step(new WriteFiles())
      .step(new ShowResult())
      .finish((state) => {
        return state.answer;
      });
  }

  /**
   * What every step is given: the run's facts, and the parts of this command
   * that read the project, draw and answer.
   *
   * @returns The services.
   */
  private services(): EnableServices {
    return {
      cwd: this.cwd,
      env: this.env,
      ask: this.ask,
      suggest: this.suggest,
      dryRun: this.dryRun,
      isJson: this.isJson,
      source: this.meta.source,
      report: (change) => {
        this.report(change);
      },
      emit: (result) => {
        return this.emit(result);
      },
      argsOf: (command) => {
        return this.argsOf(command);
      },
      followUps: (changed, leading) => {
        return this.followUps(changed, leading);
      },
      nonInteractive: this.nonInteractive,
      developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
      loadSchemaTarget: (flags) => {
        return this.loadSchemaTarget(flags);
      },
      connect: () => {
        return this.connect();
      },
      realRun: () => {
        return this.realRun();
      },
      write: (target, change) => {
        return this.write(target, change, undefined);
      },
    };
  }
}
