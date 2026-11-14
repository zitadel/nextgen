import { credentialVariables, providerOf, selectionName } from "@zitadel/config/idp";

import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { callbackUriFor, loopbackIssuerWarning } from "@/lib/idp";
import { loopbackReach } from "@/lib/local-server/runtime";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { Connection } from "@/lib/zitadel";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<
  "target" | "remote" | "origins" | "issuer" | "selection" | "provider" | "options" | "claims"
>;

/**
 * Works out the whole change before anything is asked or written, so every
 * refusal comes first: a connection that would step on another, a region the
 * edits cannot write, or a flow `deploy` would then reject (ADR 070 section 3).
 */
export class PlanChange extends WizardStep<
  "plan",
  Fact<"candidate" | "preview" | "names" | "summary">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "plan";

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
   * The credentials go to the project variables the connection references. A
   * connection with no `oidc` block leaves both to the variables its slug
   * derives, and a credential it holds as a value names none.
   *
   * @param needs - What was read and decided.
   * @returns The plan.
   * @throws {@link ZitadelError} When the change would be refused.
   */
  async run(needs: Needs): Promise<Fact<"candidate" | "preview" | "names" | "summary">> {
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
    const credentials = connection.credentials;
    const names =
      credentials === undefined
        ? credentialVariables(connection.slug)
        : {
            clientId:
              credentials.clientId.kind === "literal" ? undefined : credentials.clientId.variable,
            clientSecret:
              credentials.clientSecret.kind === "literal"
                ? undefined
                : credentials.clientSecret.variable,
          };
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
      names,
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
