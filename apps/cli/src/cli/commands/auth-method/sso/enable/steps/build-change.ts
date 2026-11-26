import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  ZitadelConfigClientIdMismatchError,
  ZitadelConfigConnectionFileTakenError,
  ZitadelConfigConnectionIssuerClashError,
  ZitadelConfigFlowBrokenError,
  ZitadelConfigProviderFileTakenError,
} from "@/lib/zitadel";
import { log } from "@/lib/ui";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

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
