import { Check, type Outcome } from "../check";
import type { Discovery, IdpContext, Verdict } from "./context";

/**
 * A check that reads the provider's discovery document. It waits for the
 * `discovery` check, so by the time `inspect` runs the document exists.
 */
abstract class DiscoveryCheck extends Check<IdpContext> {
  override readonly dependsOn = ["discovery"];

  protected abstract inspect(context: IdpContext, document: Discovery): Promise<Outcome> | Outcome;

  async run(context: IdpContext): Promise<Outcome> {
    const found = await context.discovery;
    if (!found.ok) {
      return { status: "skipped", message: found.reason };
    }
    return this.inspect(context, found.document);
  }
}

export class DiscoveryReachableCheck extends Check<IdpContext> {
  readonly name = "discovery";
  readonly title = "Discovery document";

  async run(context: IdpContext): Promise<Outcome> {
    const missing = context.missingEndpoints ?? [];
    // The server refuses a partial set whether or not the issuer could supply the rest, so
    // this is checked before discovery and not only when the connection names its own.
    if (missing.length > 0) {
      return {
        status: "fail",
        message: `The connection names some endpoints but not ${missing.join(", ")}`,
        recovery: `Name every endpoint in oidc in .zitadel/idps/${context.slug}.json, or none and let the issuer's discovery document supply them`,
      };
    }
    const found = await context.discovery;
    const unusable =
      found.ok && found.source === "connection"
        ? Object.entries(context.configuredEndpoints ?? {}).flatMap(([name, value]) =>
            ENDPOINT.test(value) ? [] : [name],
          )
        : [];
    if (unusable.length > 0) {
      return {
        status: "fail",
        message: `The connection's ${unusable.join(", ")} is not an https endpoint`,
        recovery: `Use an https URL (or http on localhost) for ${unusable.map((name) => `oidc.${name}`).join(", ")} in .zitadel/idps/${context.slug}.json`,
      };
    }
    if (found.ok && found.source === "connection") {
      return { status: "pass", message: "Using the endpoints written in the connection" };
    }
    if (found.ok) {
      const missing =
        found.source === "discovery" ? unusableEndpoints(found.document, context) : [];
      return missing.length === 0
        ? { status: "pass", message: `Fetched ${found.url}` }
        : {
            status: "fail",
            message: `The discovery document has no usable ${missing.join(", ")}`,
            recovery:
              missing.length === 1 && missing[0] === "userinfo_endpoint"
                ? `Set oidc.id_token_mapping to true in .zitadel/idps/${context.slug}.json to read claims from the ID token, since the provider lists no userinfo endpoint`
                : `Check oidc.issuer in .zitadel/idps/${context.slug}.json: the runtime needs an https endpoint for each of ${missing.join(", ")}`,
          };
    }
    return {
      status: "fail",
      message: found.reason,
      recovery: `Check oidc.issuer in .zitadel/idps/${context.slug}.json`,
    };
  }
}

/** What the runtime accepts as an endpoint: https, or http on a loopback host. */
const ENDPOINT =
  /^(https:\/\/[^\s/?#]+|http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?)([/?][^\s#]*)?$/;

/** The endpoints the runtime needs from the document that are missing or not usable. */
function unusableEndpoints(document: Discovery, context: IdpContext): readonly string[] {
  const needed: ReadonlyArray<readonly [string, string | undefined]> = [
    ["authorization_endpoint", document.authorization_endpoint],
    ["token_endpoint", document.token_endpoint],
    // Every ID token is verified against the keys it names, whatever supplies the claims.
    ["jwks_uri", document.jwks_uri],
    ...(context.idTokenMapping === true
      ? []
      : ([["userinfo_endpoint", document.userinfo_endpoint]] as const)),
  ];
  return needed.flatMap(([name, value]) =>
    value !== undefined && ENDPOINT.test(value) ? [] : [name],
  );
}

/** "a is", "a, b are all", so a lone entry does not read as a plural. */
const listed = (names: readonly string[]) =>
  names.length === 1 ? `${names.join("")} is` : `${names.join(", ")} are all`;

export class IssuerCheck extends DiscoveryCheck {
  readonly name = "issuer";
  readonly title = "Issuer";

  protected inspect(context: IdpContext, document: Discovery): Outcome {
    if (context.endpoints !== undefined) {
      return {
        status: "skipped",
        message: "The connection names its own endpoints, so there is no discovery document",
      };
    }
    const reported = document.issuer ?? "";
    return reported === context.issuer
      ? { status: "pass", message: "Matches the issuer the provider reports" }
      : {
          status: "fail",
          message: `The provider reports ${reported || "no issuer"}, not ${context.issuer}`,
          recovery: reported.includes("{")
            ? `The provider reports a templated issuer, ${reported}: set oidc.issuer in .zitadel/idps/${context.slug}.json to the issuer of one tenant, with the placeholder filled in`
            : `Set oidc.issuer in .zitadel/idps/${context.slug}.json to ${reported}`,
        };
  }
}

export class ScopesCheck extends DiscoveryCheck {
  readonly name = "scopes";
  readonly title = "Scopes";

  protected inspect(context: IdpContext, document: Discovery): Outcome {
    // The server refuses a connection whose scopes lack openid, whatever the provider lists.
    if (!context.scopes.includes("openid")) {
      return {
        status: "fail",
        message: "The connection's scopes do not include openid",
        recovery: `Add openid to oidc.scopes in .zitadel/idps/${context.slug}.json`,
      };
    }
    const supported = document.scopes_supported;
    if (supported === undefined) {
      return { status: "skipped", message: "The provider does not list the scopes it supports" };
    }
    const unlisted = context.scopes.filter((scope) => !supported.includes(scope));
    return unlisted.length === 0
      ? { status: "pass", message: `${listed(context.scopes)} listed by the provider` }
      : {
          status: "warn",
          message: `The provider does not list ${unlisted.join(", ")}`,
          recovery: `Check oidc.scopes in .zitadel/idps/${context.slug}.json; a provider can accept a scope it does not list`,
        };
  }
}

/** Advisory only: providers often list fewer claims than they send. */
export class ClaimsCheck extends DiscoveryCheck {
  readonly name = "claims";
  readonly title = "Mapped claims";

  protected inspect(context: IdpContext, document: Discovery): Outcome {
    const advertised = document.claims_supported;
    if (advertised === undefined) {
      return { status: "skipped", message: "The provider does not list the claims it sends" };
    }
    if (context.claims.length === 0) {
      return { status: "skipped", message: "The connection maps no claims" };
    }
    const unlisted = context.claims.filter((claim) => !advertised.includes(claim));
    return unlisted.length === 0
      ? { status: "pass", message: `${listed(context.claims)} listed by the provider` }
      : {
          status: "warn",
          message: `The provider does not list ${unlisted.join(", ")}`,
          recovery: `Check claim_mapping in .zitadel/idps/${context.slug}.json; a provider can send a claim it does not list`,
        };
  }
}

export class PkceCheck extends DiscoveryCheck {
  readonly name = "pkce";
  readonly title = "PKCE";

  protected inspect(_context: IdpContext, document: Discovery): Outcome {
    const methods = document.code_challenge_methods_supported;
    if (methods === undefined) {
      return { status: "skipped", message: "The provider does not say whether it supports PKCE" };
    }
    return methods.includes("S256")
      ? { status: "pass", message: "The provider supports S256" }
      : { status: "warn", message: "The provider does not list S256 among its challenge methods" };
  }
}

/** What to do about a rejection, in the provider's own console. */
function recoveryFor(problem: "client" | "redirect_uri", context: IdpContext): string {
  const where = context.consoleUrl ?? "the provider's console";
  switch (problem) {
    case "redirect_uri":
      return `Register ${context.callbackUri} as a redirect URI at ${where}`;
    case "client":
      return `Check the client ID against the client registered at ${where}`;
  }
}

function outcomeOf(verdict: Verdict, context: IdpContext, accepted: string): Outcome {
  switch (verdict.kind) {
    case "accepted":
      return { status: "pass", message: accepted };
    case "rejected":
      return {
        status: "fail",
        message: verdict.reason,
        recovery: recoveryFor(verdict.problem, context),
      };
    case "unknown":
      return {
        status: "skipped",
        message: "The provider answered in a way this check does not recognise",
      };
  }
}

/** Asks the provider's authorization endpoint, with no user, whether it accepts the request. */
export class AuthorizeProbeCheck extends DiscoveryCheck {
  readonly name = "callback-uri";
  readonly title = "Client and callback URI";

  protected async inspect(context: IdpContext, document: Discovery): Promise<Outcome> {
    if (context.probes === undefined || document.authorization_endpoint === undefined) {
      return { status: "skipped", message: "No probe exists for this provider" };
    }
    // The endpoint may already carry a query (prompt=consent, say), so the probe's
    // parameters join it instead of opening a second one.
    const url = new URL(document.authorization_endpoint);
    for (const [name, value] of Object.entries({
      client_id: context.clientId,
      redirect_uri: context.callbackUri,
      response_type: "code",
      scope: context.scopes.join(" "),
      state: "zitadel-check",
    })) {
      url.searchParams.set(name, value);
    }
    const asked = await context.request(url.toString()).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
    if ("error" in asked) {
      const reason = asked.error instanceof Error ? asked.error.message : String(asked.error);
      return {
        status: "fail",
        message: `The authorization endpoint could not be reached: ${reason}`,
        recovery: `Check that ${url.origin} is reachable from this machine, then run the check again`,
      };
    }
    return outcomeOf(
      context.probes.authorize(asked.response),
      context,
      "The provider accepts the client and the callback URI",
    );
  }
}
