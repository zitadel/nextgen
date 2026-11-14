import { providerOf, selectionName } from "@zitadel/config/idp";
import {
  callbackUriFor,
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
import { Connection, type DocumentChange, type SsoOptions } from "@/lib/zitadel";

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
 * Works out the whole change before anything is asked or written, so every
 * refusal comes first: a connection that would step on another, a region the
 * edits cannot write, or a flow `deploy` would then reject (ADR 070 section 3).
 */
export class PlanChange extends WizardStep<"plan", Planned, Needs, EnableServices> {
  readonly key = "plan";

  /**
   * Make the candidate connection and the change it would make.
   *
   * @param needs - What was read and decided.
   * @param services - What the command provides.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(needs: Needs, services: EnableServices): Promise<Planned> {
    const candidate = Connection.forProvider(needs.provider, needs.target.schema);
    const preview = needs.target.config.connections.enable(
      needs.target.schema,
      candidate,
      needs.options,
    );
    const reach = await loopbackReach(needs.target.cwd, needs.remote.server);
    const loopback = loopbackIssuerWarning(needs.selection, reach);
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const delivery = new CredentialDelivery({
      connection: preview.document,
      reused: !preview.created,
      suggest: services.suggest,
    });
    const prompt = new CredentialPrompt({
      selection: needs.selection,
      reused: !preview.created,
      secretVariable: delivery.names.clientSecret,
      ask: services.ask,
      developmentBuild: services.developmentBuild,
      suggest: services.suggest,
    });
    const summary = this.summarize({
      projectId: needs.remote.projectId,
      selection: needs.selection,
      target: needs.target,
      preview,
      issuer: needs.issuer,
      origins: needs.origins,
    });
    return {
      candidate,
      preview,
      delivery,
      prompt,
      summary,
    };
  }

  /**
   * What the run says about the connection it adds.
   *
   * @remarks
   * The callback URI is the connection's own route, so its slug decides it: a
   * reused connection keeps the slug it was created with.
   *
   *
   * A Set first: two spellings of one origin, such as with and without a trailing slash, name the
   * same redirect URI, which is listed once.
   * @param input - The project, the provider, what the run read, the change
   *   worked out before anything was asked, and the Project's issuer.
   * @returns The summary.
   */
  private summarize(input: SummaryInput): Summary {
    const connection = input.preview.document;
    const callbackUri = callbackUriFor(input.issuer, connection.slug);
    const deployedCallbackUris = [
      ...new Set(
        input.origins.primary.map((origin) => {
          return callbackUriFor(origin, connection.slug);
        }),
      ),
    ].filter((uri) => {
      return uri !== callbackUri;
    });
    const previewCallbackUris = [
      ...new Set(
        input.origins.preview.map((pattern) => {
          return callbackUriFor(pattern, connection.slug);
        }),
      ),
    ].filter((uri) => {
      return uri !== callbackUri && !deployedCallbackUris.includes(uri);
    });
    return {
      projectId: input.projectId,
      provider: selectionName(input.selection),
      displayName: providerOf(input.selection).displayName,
      schema: input.target.schema.name,
      connection,
      reused: !input.preview.created,
      callbackUri,
      deployedCallbackUris,
      previewCallbackUris,
    };
  }
}

/**
 * What `summarize` words the summary from.
 */
type SummaryInput = {
  readonly projectId: string;
  readonly selection: ProviderSelection;
  readonly target: SchemaTarget;
  readonly preview: DocumentChange<Connection>;
  readonly issuer: string;
  readonly origins: Origins;
};
