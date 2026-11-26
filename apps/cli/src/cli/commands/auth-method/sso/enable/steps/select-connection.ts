import { providerOf } from "@zitadel/config/idp";

import {
  ACTION_CLASH_REFUSAL,
  type EnableServices,
  type Fact,
  ROUTE_LOSS_REFUSAL,
  SLUG_DUPLICATED_REFUSAL,
} from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { WizardStep } from "@/lib/wizard";
import {
  ZitadelConfigConnectionFileTakenError,
  ZitadelConfigConnectionIssuerClashError,
  ZitadelConfigConnectionNotOidcError,
  ZitadelConfigFlowBrokenError,
  ZitadelConfigProviderFileTakenError,
  ZitadelConfigSettingUnusableError,
  ZitadelConfigSlugDuplicatedError,
  ZitadelConfigOutcomeActionClashError,
  ZitadelConfigRenameActionClashError,
  ZitadelConfigRenameRouteLossError,
} from "@/lib/zitadel";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "choice" | "target">;

/**
 * What a slug that already names a connection with no issuer is refused for.
 */
const NOT_OIDC_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Fix the file, or choose another slug, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a setting a connection file holds that the platform would not take is
 * refused for.
 */
const SETTING_UNUSABLE_REFUSAL = {
  message: "{message}",
  hint: "Fix it in that file, or choose another slug.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a slug that already names a connection to another issuer is refused for.
 */
const ISSUER_CLASH_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
  details: {
    file: "{path}",
    slug: "{slug}",
    issuer: "{issuer}",
    existing_issuer: "{existingIssuer}",
  },
} as const satisfies Refusal;

/**
 * What a catalog provider's connection file name another connection already
 * has is refused for.
 */
const PROVIDER_FILE_TAKEN_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Rename or remove that file, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a custom connection's file name another connection already has is
 * refused for.
 */
const CONNECTION_FILE_TAKEN_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Rename or remove that file, or choose another slug, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a change is refused for when it would make a login flow stop validating.
 */
const FLOW_BROKEN_REFUSAL = {
  message: "{message}",
  hint: "Fix the steps named above, then run the command again.",
} as const satisfies Refusal;

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
   * Resolve the provider.
   *
   * @param needs - The flags, how they choose a provider, and what was read.
   * @returns The provider and the options the edit is made with.
   */
  async run(needs: Needs): Promise<Fact<"selection" | "provider" | "options">> {
    try {
      const selection = await needs.choice.resolve(needs.target, this.deps.ask);
      return {
        selection,
        provider: providerOf(selection),
        options: {
          clientId: needs.flags.clientId,
          given: needs.choice.givenSettings(selection),
          dryRun: this.deps.dryRun,
        },
      };
    } catch (error) {
      if (error instanceof ZitadelConfigSlugDuplicatedError) {
        throw refusalError(SLUG_DUPLICATED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigRenameActionClashError) {
        throw refusalError(ACTION_CLASH_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigOutcomeActionClashError) {
        throw refusalError(ACTION_CLASH_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigRenameRouteLossError) {
        throw refusalError(ROUTE_LOSS_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigConnectionNotOidcError) {
        throw refusalError(NOT_OIDC_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigSettingUnusableError) {
        throw refusalError(SETTING_UNUSABLE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigConnectionIssuerClashError) {
        throw refusalError(ISSUER_CLASH_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigProviderFileTakenError) {
        throw refusalError(PROVIDER_FILE_TAKEN_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigConnectionFileTakenError) {
        throw refusalError(CONNECTION_FILE_TAKEN_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigFlowBrokenError) {
        throw refusalError(FLOW_BROKEN_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
