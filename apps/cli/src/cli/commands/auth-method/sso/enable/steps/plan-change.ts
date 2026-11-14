import { providerOf, selectionName } from "@zitadel/config/idp";
import {
  callbackUriFor,
  type ClaimRequest,
  claimFlagTexts,
  CredentialDelivery,
  CredentialPrompt,
  loopbackIssuerWarning,
} from "@/lib/idp";

import type { IdpProvider, ProviderSelection } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { Origins } from "@/lib/backend";
import { loopbackReach } from "@/lib/local-server/runtime";
import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { type ClaimChoice, Connection, type DocumentChange, type SsoOptions } from "@/lib/zitadel";

import type { Summary, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  target: SchemaTarget;
  remote: RemoteConnection;
  origins: Origins;
  issuer: string;
  selection: ProviderSelection;
  provider: IdpProvider;
  options: SsoOptions;
  claimRequest: ClaimRequest;
  claims: ClaimChoice | undefined;
}>;

/**
 * What the plan settles.
 */
type Planned = Readonly<{
  /**
   * The connection the provider's defaults make, with the claims the flags
   * mapped.
   */
  candidate: Connection;

  /**
   * The change worked out before anything was asked.
   */
  preview: DocumentChange<Connection>;

  /**
   * Where the credentials go, and how that is reported.
   */
  delivery: CredentialDelivery;

  /**
   * The questions that ask for the credentials.
   */
  prompt: CredentialPrompt;

  /**
   * What the run says about the connection.
   */
  summary: Summary;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "developmentBuild" | "suggest">;

/**
 * Works out the whole change before anything is asked or written, so every
 * refusal comes first: a connection that would step on another, a region the
 * edits cannot write, or a flow `deploy` would then reject (ADR 070 section 3).
 */
export class PlanChange extends WizardStep<"plan", Planned, Needs> {
  readonly key = "plan";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

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
   * URI that equals either, is left out of its list.
   *
   * @param needs - What was read and decided.
   * @param this.deps - What the command provides.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(needs: Needs): Promise<Planned> {
    const plain = Connection.forProvider(needs.provider, needs.target.schema);
    const candidate = needs.claims === undefined ? plain : plain.withClaims(needs.claims).document;
    const preview = needs.target.config.connections.enable(needs.target.schema, candidate, {
      ...needs.options,
      attributes: needs.claims?.created,
    });
    const reach = await loopbackReach(needs.target.cwd, needs.remote.server);
    const loopback = loopbackIssuerWarning(needs.selection, reach);
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const delivery = new CredentialDelivery({
      connection: preview.document,
      reused: !preview.created,
      suggest: this.deps.suggest,
    });
    const connection = preview.document;
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
        reused: !preview.created,
        secretVariable: delivery.names.clientSecret,
        ask: this.deps.ask,
        developmentBuild: this.deps.developmentBuild,
        suggest: this.deps.suggest,
        claims: claimFlagTexts(needs.claimRequest),
      }),
      summary: {
        projectId: needs.remote.projectId,
        provider: selectionName(needs.selection),
        displayName: providerOf(needs.selection).displayName,
        schema: needs.target.schema.name,
        connection,
        reused: !preview.created,
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
  }
}
