import { isLoopbackIssuer } from "@zitadel/config/idp";

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
    const found = await context.discovery;
    if (found.ok && found.source === "connection") {
      return { status: "pass", message: "Using the endpoints written in the connection" };
    }
    return found.ok
      ? { status: "pass", message: `Fetched ${found.url}` }
      : {
          status: "fail",
          message: found.reason,
          recovery: `Check oidc.issuer in .zitadel/idps/${context.slug}.json`,
        };
  }
}

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
          recovery: `Set oidc.issuer in .zitadel/idps/${context.slug}.json to ${reported}`,
        };
  }
}

export class ScopesCheck extends DiscoveryCheck {
  readonly name = "scopes";
  readonly title = "Scopes";

  protected inspect(context: IdpContext, document: Discovery): Outcome {
    const supported = document.scopes_supported;
    if (supported === undefined) {
      return { status: "skipped", message: "The provider does not list the scopes it supports" };
    }
    if (context.scopes.length === 0) {
      return { status: "skipped", message: "The connection asks for no scopes" };
    }
    const unlisted = context.scopes.filter((scope) => !supported.includes(scope));
    return unlisted.length === 0
      ? { status: "pass", message: `${context.scopes.join(", ")} are all listed by the provider` }
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
      ? { status: "pass", message: `${context.claims.join(", ")} are all listed by the provider` }
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

/** The server's rule for an endpoint: HTTPS, or plain HTTP only to this machine. */
function isSecureEndpoint(endpoint: string): boolean {
  return (
    endpoint.startsWith("https://") ||
    (endpoint.startsWith("http://") && isLoopbackIssuer(endpoint))
  );
}

/** What to do about a rejection, in the provider's own console. */
function recoveryFor(problem: "client" | "redirect_uri" | "secret", context: IdpContext): string {
  const where = context.consoleUrl ?? "the provider's console";
  switch (problem) {
    case "redirect_uri":
      return `Register ${context.callbackUri} as a redirect URI at ${where}`;
    case "client":
      return `Check the client ID against the client registered at ${where}`;
    case "secret":
      return `Create a new client secret at ${where} and store it as the connection's secret`;
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
    const response = await context.request(url.toString());
    return outcomeOf(
      context.probes.authorize(response),
      context,
      "The provider accepts the client and the callback URI",
    );
  }
}

/** Sends a code the provider never issued, to learn whether it accepts the client secret. */
export class SecretProbeCheck extends DiscoveryCheck {
  readonly name = "client-secret";
  readonly title = "Client secret";

  protected async inspect(context: IdpContext, document: Discovery): Promise<Outcome> {
    if (context.probes === undefined || document.token_endpoint === undefined) {
      return { status: "skipped", message: "No probe exists for this provider" };
    }
    if (context.clientSecret === undefined) {
      return {
        status: "skipped",
        message: "The secret is write-only, so it cannot be read back; supply it to check it",
      };
    }
    if (!isSecureEndpoint(document.token_endpoint)) {
      return {
        status: "fail",
        message: `The token endpoint ${document.token_endpoint} is not HTTPS, so the secret was not sent`,
        recovery: "Use an https:// token endpoint; plain http is only allowed for localhost",
      };
    }
    const grant = {
      grant_type: "authorization_code",
      code: "zitadel-check",
      redirect_uri: context.callbackUri,
    };
    // As the engine does: the Authorization header for client_secret_basic, whose
    // credentials are form-encoded before they are base64-encoded (RFC 6749 2.3.1),
    // or the form body for client_secret_post.
    const response = await context.request(
      document.token_endpoint,
      context.tokenAuthMethod === "client_secret_basic"
        ? {
            method: "POST",
            headers: {
              authorization: `Basic ${Buffer.from(
                `${encodeURIComponent(context.clientId)}:${encodeURIComponent(context.clientSecret)}`,
              ).toString("base64")}`,
            },
            body: new URLSearchParams(grant),
          }
        : {
            method: "POST",
            body: new URLSearchParams({
              ...grant,
              client_id: context.clientId,
              client_secret: context.clientSecret,
            }),
          },
    );
    return outcomeOf(
      context.probes.token(response),
      context,
      "The provider accepts the client secret",
    );
  }
}
