import { providerOf, selectionName } from "@zitadel/config/idp";

import { FLOW_UNCHECKED_REFUSAL } from "@/cli/commands/auth-method/command";
import {
  ACTION_CLASH_REFUSAL,
  CONNECTION_DUPLICATED_REFUSAL,
  CREDENTIALS_DOUBLED_REFUSAL,
  PROVIDER_MISMATCH_REFUSAL,
  ROUTE_LOSS_REFUSAL,
  SLUG_DUPLICATED_REFUSAL,
  VARIABLE_SHARED_REFUSAL,
} from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import {
  callbackUriFor,
  CredentialDelivery,
  CredentialPrompt,
  loopbackIssuerWarning,
} from "@/lib/idp";
import { pipedFrom } from "@/lib/suggestion";
import { warnings } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";
import {
  Connection,
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
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigProviderFileTakenError,
} from "@/lib/zitadel";

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
 * What the step reads from what is known.
 */
type Needs = Fact<
  "target" | "remote" | "origins" | "issuer" | "selection" | "provider" | "options"
>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "developmentBuild" | "suggest" | "again" | "machine">;

/**
 * Works out the whole change before anything is asked or written, so every
 * refusal comes first: a connection that would step on another, a region the
 * edits cannot write, or a flow `deploy` would then reject (ADR 070 section 3).
 */
export class PlanChange extends WizardStep<
  "plan",
  Fact<"candidate" | "preview" | "delivery" | "prompt" | "summary">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "plan";

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
   * Make the candidate connection and the change it would make, and say what
   * the run does about the connection it adds.
   *
   * @remarks
   * The callback URI is the connection's own route, so its slug decides it: a
   * reused connection keeps the slug it was created with. Each list of redirect
   * URIs is built from a Set first, because two spellings of one origin, such as
   * with and without a trailing slash, name the same redirect URI, which is
   * listed once. A deployed URI that equals the development one, and a preview
   * URI that equals either, is left out of its list. A custom connection's
   * settings are not a retry an agent can be handed whole, so the credential
   * prompt is offered a retry only for a catalog provider.
   *
   * @param needs - What was read and decided.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(
    needs: Needs,
  ): Promise<Fact<"candidate" | "preview" | "delivery" | "prompt" | "summary">> {
    try {
      const candidate = Connection.forProvider(needs.provider, needs.target.schema);
      const preview = needs.target.config.connections.enable(
        needs.target.schema,
        candidate,
        needs.options,
      );
      const loopback = loopbackIssuerWarning(
        needs.selection,
        await this.deps.machine.loopbackReach(needs.target.cwd, needs.remote.server),
      );
      if (loopback !== undefined) {
        warnings.report(loopback);
      }
      const connection = preview.document;
      const reused = !preview.created;
      const delivery = new CredentialDelivery({
        connection,
        reused,
        republish: (missing) => {
          return this.deps.suggest({
            id: "variable:set",
            args: { name: missing.name },
            flags: { secret: missing.secret },
          });
        },
      });
      const callbackUri = callbackUriFor(needs.issuer, connection.slug);
      const deployedCallbackUris = [
        ...new Set(
          needs.origins.primary.map((origin) => {
            return callbackUriFor(origin, connection.slug);
          }),
        ),
      ].filter((uri) => {
        return uri !== callbackUri;
      });
      return {
        candidate,
        preview,
        delivery,
        prompt: new CredentialPrompt({
          selection: needs.selection,
          reused,
          secretVariable: delivery.names.clientSecret,
          ask: this.deps.ask,
          developmentBuild: this.deps.developmentBuild,
          retry: async (clientId, piped) => {
            if (needs.selection.kind !== "catalog") {
              return undefined;
            }
            const command = await this.deps.again("auth-method:sso:enable", {
              with: {
                provider: selectionName(needs.selection),
                clientId,
              },
            });

            return piped ? pipedFrom("CLIENT_SECRET", command) : command;
          },
        }),
        summary: {
          projectId: needs.remote.projectId,
          provider: selectionName(needs.selection),
          displayName: providerOf(needs.selection).displayName,
          schema: needs.target.schema.name,
          connection,
          reused,
          callbackUri,
          deployedCallbackUris,
          previewCallbackUris: [
            ...new Set(
              needs.origins.preview.map((pattern) => {
                return callbackUriFor(pattern, connection.slug);
              }),
            ),
          ].filter((uri) => {
            return uri !== callbackUri && !deployedCallbackUris.includes(uri);
          }),
        },
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
      if (error instanceof ZitadelConfigFlowUncheckedError) {
        throw refusalError(FLOW_UNCHECKED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
