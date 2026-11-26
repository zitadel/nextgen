import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  ZitadelConfigClientIdMismatchError,
  ZitadelConfigConnectionDuplicatedError,
  ZitadelConfigConnectionProviderMismatchError,
  ZitadelConfigCredentialsDoubledError,
  ZitadelConfigSlugDuplicatedError,
  ZitadelConfigVariableSharedError,
  ZitadelConfigOutcomeActionClashError,
  ZitadelConfigRenameActionClashError,
  ZitadelConfigRenameRouteLossError,
  ZitadelConfigConnectionFileTakenError,
  ZitadelConfigConnectionIssuerClashError,
  ZitadelConfigFlowBrokenError,
  ZitadelConfigProviderFileTakenError,
} from "@/lib/zitadel";
import { log } from "@/lib/ui";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * What more than one connection to the provider being enabled is refused for.
 */
const CONNECTION_DUPLICATED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Keep the one this project should use and remove the others, then run the command again.",
  details: {
    provider: "{provider}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/**
 * What more than one connection named by the slug being enabled is refused for.
 */
const SLUG_DUPLICATED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
  details: {
    slug: "{slug}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/**
 * What a new connection's file that is a connection with its slug to another
 * issuer is refused for.
 */
const PROVIDER_MISMATCH_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a connection reading both credentials from one variable is refused for.
 */
const CREDENTIALS_DOUBLED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
  details: {
    slug: "{slug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/**
 * What two connections reading a credential from one variable are refused for.
 */
const VARIABLE_SHARED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Point one of them at a variable of its own, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
    other_slug: "{otherSlug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/**
 * What a step whose action is named like an outcome the edit writes is
 * refused for.
 */
const ACTION_CLASH_REFUSAL = {
  message: "{message}",
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
  details: {
    step: "{step}",
    action: "{action}",
  },
} as const satisfies Refusal;

/**
 * What a step whose legacy outcome declares a purpose or an action is refused
 * for.
 */
const ROUTE_LOSS_REFUSAL = {
  message: "{message}",
  hint: 'Remove purpose and action from the transition "{transition}" on step "{step}", then run auth-method sso enable again.',
  details: {
    step: "{step}",
    transition: "{transition}",
  },
} as const satisfies Refusal;

/**
 * What a client id other than the one the connection file holds is refused for.
 */
const CLIENT_ID_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
  details: {
    file: "{path}",
    stored_client_id: "{stored}",
    supplied_client_id: "{supplied}",
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
 * What the step reads from the steps before it.
 */
type Needs = Fact<"target" | "candidate" | "preview" | "options" | "summary" | "given">;

/**
 * Settles the change to write, and checks that saving it would be accepted.
 */
export class BuildChange extends WizardStep<"change", Fact<"change">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "change";

  /**
   * Make the change again when a development run answered other endpoints, and
   * check it.
   *
   * @remarks
   * The change is the preview, or the same change made again with the endpoints
   * a development run answered. The endpoints change only a new connection's
   * body, never which files the change writes.
   *
   * The credentials go before the files: saving writes the connection first, so
   * a write that then fails would leave a connection on disk whose credentials
   * were never stored, and the rerun would take it as reused and not ask for
   * them again. Saving's own refusals are checked here, before anything is
   * published, so a path it would refuse leaves the project's variables alone
   * too.
   *
   * @param needs - What was read and decided.
   * @returns The change.
   * @throws {@link ZitadelError} When saving the change would be refused.
   */
  async run(needs: Needs): Promise<Fact<"change">> {
    try {
      const change =
        needs.given.endpoints === undefined
          ? needs.preview
          : needs.target.config.connections.enable(
              needs.target.schema,
              needs.candidate.withEndpoints(needs.given.endpoints).document,
              needs.options,
            );
      if (needs.summary.reused) {
        log.debug(`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`);
      }
      await change.check(needs.target.store);
      return {
        change,
      };
    } catch (error) {
      if (error instanceof ZitadelConfigSlugDuplicatedError) {
        throw refusalError(SLUG_DUPLICATED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigConnectionDuplicatedError) {
        throw refusalError(CONNECTION_DUPLICATED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigConnectionProviderMismatchError) {
        throw refusalError(PROVIDER_MISMATCH_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigCredentialsDoubledError) {
        throw refusalError(CREDENTIALS_DOUBLED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigVariableSharedError) {
        throw refusalError(VARIABLE_SHARED_REFUSAL, {
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
      if (error instanceof ZitadelConfigClientIdMismatchError) {
        throw refusalError(CLIENT_ID_MISMATCH_REFUSAL, {
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
