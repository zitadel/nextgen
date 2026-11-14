import { providerOf, selectionName } from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import {
  callbackUriFor,
  claimFlagTexts,
  CredentialDelivery,
  CredentialPrompt,
  loopbackIssuerWarning,
} from "@/lib/idp";
import { loopbackReach } from "@/lib/local-server/runtime";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { Connection } from "@/lib/zitadel";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<
  | "target"
  | "remote"
  | "origins"
  | "issuer"
  | "selection"
  | "provider"
  | "options"
  | "claimRequest"
  | "claims"
>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "developmentBuild" | "suggest">;

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
   * URI that equals either, is left out of its list.
   *
   * @param needs - What was read and decided.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(
    needs: Needs,
  ): Promise<Fact<"candidate" | "preview" | "delivery" | "prompt" | "summary">> {
    const plain = Connection.forProvider(needs.provider, needs.target.schema);
    const candidate = needs.claims === undefined ? plain : plain.withClaims(needs.claims).document;
    const preview = needs.target.config.connections.enable(needs.target.schema, candidate, {
      ...needs.options,
      attributes: needs.claims?.created,
    });
    const loopback = loopbackIssuerWarning(
      needs.selection,
      await loopbackReach(needs.target.cwd, needs.remote.server),
    );
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const connection = preview.document;
    const reused = !preview.created;
    const delivery = new CredentialDelivery({
      connection,
      reused,
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
        reused,
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
  }
}
