import type { IdpProvider, ProviderSelection } from "@zitadel/config/idp";
import { providerOf, selectionName } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { Summary } from "@/cli/commands/auth-method/sso/enable/shared";
import type { Origins } from "@/lib/backend";
import {
  callbackUriFor,
  CredentialDelivery,
  CredentialPrompt,
  loopbackIssuerWarning,
} from "@/lib/idp";
import { loopbackReach } from "@/lib/local-server/runtime";
import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import type { Suggest } from "@/lib/suggestion";
import type { Questions } from "@/lib/ui";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { Connection, type DocumentChange, type SsoOptions } from "@/lib/zitadel";

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
}>;

/**
 * What the plan settles.
 */
type Planned = Readonly<{
  /**
   * The connection the provider's defaults make.
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
type Deps = Readonly<{
  /**
   * The questions the run may ask a person.
   */
  ask: Questions;

  /**
   * Whether this is a development build that may ask where a provider answers.
   */
  developmentBuild: boolean;

  /**
   * Builds the commands the run suggests.
   */
  suggest: Suggest;
}>;

/**
 * Works out the whole change before anything is asked or written, so every
 * refusal comes first: a connection that would step on another, a region the
 * edits cannot write, or a flow `deploy` would then reject (ADR 070 section 3).
 */
export class PlanChange extends WizardStep<"plan", Planned, Needs> {
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
   * URI that equals either, is left out of its list.
   *
   * @param needs - What was read and decided.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(needs: Needs): Promise<Planned> {
    const candidate = Connection.forProvider(needs.provider, needs.target.schema);
    const preview = needs.target.config.connections.enable(
      needs.target.schema,
      candidate,
      needs.options,
    );
    const loopback = loopbackIssuerWarning(
      needs.selection,
      await loopbackReach(needs.target.cwd, needs.remote.server),
    );
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const connection = preview.document;
    const delivery = new CredentialDelivery({
      connection,
      reused: !preview.created,
      suggest: this.deps.suggest,
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
        reused: !preview.created,
        secretVariable: delivery.names.clientSecret,
        ask: this.deps.ask,
        developmentBuild: this.deps.developmentBuild,
        suggest: this.deps.suggest,
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
