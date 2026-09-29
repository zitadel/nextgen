import {
  credentialVariables,
  variableReference,
  type CallbackGuidance,
  type IdpProvider,
  type ScaffoldOptions,
} from "./provider.js";

/**
 * The parts of a connection document every OIDC provider composes the same way.
 *
 * A subclass supplies what is genuinely its own — the vendor's identity, its
 * issuer, its claim table, and any protocol settings it needs — and inherits
 * the composition. Nothing here knows about a specific vendor, so a provider
 * whose document is shaped differently overrides rather than adds a branch.
 */
export abstract class OidcProvider implements IdpProvider {
  abstract readonly slug: string;
  abstract readonly displayName: string;
  abstract readonly template: string;
  abstract readonly consoleUrl: string;
  abstract readonly docsUrl: string;
  abstract readonly callbackGuidance: CallbackGuidance;
  abstract readonly issuer: string;

  /**
   * Schema property name → the claim this provider documents for it.
   *
   * Authored per provider rather than derived: each row pairs a property with
   * the vendor's documented claim name, and a wrong one fails silently — the
   * claim is never found and the property stays unmapped.
   */
  protected abstract readonly claimTable: Readonly<Record<string, string>>;

  /** Scopes the connection requests. */
  protected abstract readonly scopes: readonly string[];

  /** The claim that carries the provider's stable, unique id for an account. */
  protected readonly subjectClaim: string = "sub";

  /**
   * Schema property name → how its value is verified: a claim to read, `true`
   * for a provider trusted outright, or `"$supplementary_fetch"`.
   *
   * Keyed by schema property, like {@link claimTable}, so it narrows with it.
   */
  protected readonly verifiedClaims: Readonly<Record<string, string | true>> = {};

  /** Parameters the vendor wants on every authorization request. */
  protected readonly staticAuthorizeParameters: Readonly<Record<string, string>> = {};

  claimMapping(schemaProperties: Iterable<string>): Record<string, string> {
    const defined = new Set(schemaProperties);
    return Object.fromEntries(
      Object.entries(this.claimTable).filter(([property]) => defined.has(property)),
    );
  }

  /**
   * Compose the connection document. Pure: it returns the object the caller
   * writes to `.zitadel/idps/<slug>.json`, and performs no IO.
   *
   * Neither credential is written into it. Both are `${{ NAME }}` references to
   * project variables: the secret because the document is committed and a
   * revision is immutable, so a literal could never be scrubbed; the id because
   * each environment registers its own application, and a literal would force
   * one connection file per environment.
   *
   * Endpoints are named only when the connection points somewhere other than
   * the vendor, and then only the issuer. The engine accepts a connection
   * naming every endpoint or none, and it needs four — so a subset is rejected,
   * and a stand-in serves its own discovery document as the vendor does.
   */
  connection(options: ScaffoldOptions): Record<string, unknown> {
    const slug = options.slug ?? this.slug;
    const claimMapping = this.claimMapping(options.schemaProperties);
    // Verification is of a mapped value, so it narrows to what was mapped: a
    // schema without `email` gets no email mapping, and an `email` entry here
    // would then claim to verify a value this connection never supplies.
    const verifiedClaims = Object.fromEntries(
      Object.entries(this.verifiedClaims).filter(([property]) => property in claimMapping),
    );
    const issuer = options.endpoints?.issuer;
    const variables = credentialVariables(slug);
    return {
      ...(options.schemaRef ? { $schema: options.schemaRef } : {}),
      slug,
      protocol: "oidc",
      template: this.template,
      display_name: this.displayName,
      subject_claim: this.subjectClaim,
      ...(Object.keys(verifiedClaims).length > 0 ? { verified_claims: verifiedClaims } : {}),
      ...(Object.keys(claimMapping).length > 0 ? { claim_mapping: claimMapping } : {}),
      provisioning: { creation: "auto" },
      oidc: {
        issuer: issuer !== undefined && issuer !== "" ? issuer : this.issuer,
        scopes: [...this.scopes],
        ...(Object.keys(this.staticAuthorizeParameters).length > 0
          ? { static_authorize_parameters: this.staticAuthorizeParameters }
          : {}),
        client_id: variableReference(variables.clientId),
        client_secret: variableReference(variables.clientSecret),
      },
    };
  }
}
