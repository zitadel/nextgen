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
    const reported = document.issuer ?? "";
    return reported.replace(/\/$/, "") === context.issuer.replace(/\/$/, "")
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
    const unsupported = context.scopes.filter((scope) => !supported.includes(scope));
    return unsupported.length === 0
      ? { status: "pass", message: `${context.scopes.join(", ")} are all supported` }
      : {
          status: "fail",
          message: `The provider does not support ${unsupported.join(", ")}`,
          recovery: `Remove them from oidc.scopes in .zitadel/idps/${context.slug}.json`,
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
    const query = new URLSearchParams({
      client_id: context.clientId,
      redirect_uri: context.callbackUri,
      response_type: "code",
      scope: context.scopes.join(" "),
      state: "zitadel-check",
    });
    const response = await context.request(`${document.authorization_endpoint}?${query}`);
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
    const response = await context.request(document.token_endpoint, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: context.clientId,
        client_secret: context.clientSecret,
        code: "zitadel-check",
        redirect_uri: context.callbackUri,
      }),
    });
    return outcomeOf(
      context.probes.token(response),
      context,
      "The provider accepts the client secret",
    );
  }
}
