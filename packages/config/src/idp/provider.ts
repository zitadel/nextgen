/**
 * What the CLI needs to know about one identity provider to scaffold a working
 * connection for it: how to name it, where to send the developer to register an
 * application, and how to compose the connection document.
 *
 * One class per provider, because a provider is not only a table of values.
 * Google is pure data today; GitHub speaks OAuth2 rather than OIDC, has no
 * family-name claim, and needs a second request to read an email at all. A
 * shape that only holds data forces that behaviour somewhere else, where it
 * stops being the provider's business and starts being a branch in shared code.
 */

/**
 * Whether the vendor accepts many redirect URIs on a single client, or needs a
 * separate application per environment. Surfaced when the developer is told
 * what to register, so they register the right thing.
 */
export type CallbackGuidance = "multi_uri_client" | "app_per_environment";

/** Where a connection points, when not at the vendor. */
export type ConnectionEndpoints = {
  readonly issuer?: string;
};

/** What a connection document needs beyond the provider's own knowledge. */
export type ScaffoldOptions = {
  /** Properties the target user schema defines, which bounds the claim mapping. */
  readonly schemaProperties: Iterable<string>;
  /** Slug to write under; defaults to the provider's own. */
  readonly slug?: string;
  /** `$schema` pointer, relative to `.zitadel/idps/`. */
  readonly schemaRef?: string;
  /** Point the connection somewhere other than the vendor (local testing). */
  readonly endpoints?: ConnectionEndpoints;
};

export interface IdpProvider {
  /** Default connection slug, and the name `--provider` takes. */
  readonly slug: string;
  /** Written to the connection and shown on the sign-in button. */
  readonly displayName: string;
  /**
   * Written to the connection as `template`. Keys vendor knowledge only —
   * glyphs, button branding, the setup scan — and carries no protocol
   * behaviour.
   */
  readonly template: string;
  /** Where the developer registers the application. */
  readonly consoleUrl: string;
  /** The vendor's own integration documentation. */
  readonly docsUrl: string;
  readonly callbackGuidance: CallbackGuidance;
  /** The issuer the vendor publishes, and the default when one is asked for. */
  readonly issuer: string;
  /**
   * The claims this provider emits, keyed by schema property name, narrowed to
   * the properties the target schema actually defines.
   */
  claimMapping(schemaProperties: Iterable<string>): Record<string, string>;
  /** The document `zitadel setup` writes to `.zitadel/idps/<slug>.json`. */
  connection(options: ScaffoldOptions): Record<string, unknown>;
}

/** The project variables a connection's two credentials reference. */
export type CredentialVariables = {
  readonly clientId: string;
  readonly clientSecret: string;
};

/**
 * The variables a connection scaffolded under `slug` references.
 *
 * Derived from the slug rather than the provider: a Project may hold a second
 * connection for the same provider under a slug of its own, and its
 * credentials belong to that connection, not to the provider.
 */
export function credentialVariables(slug: string): CredentialVariables {
  return {
    clientId: credentialVariable(slug, "CLIENT_ID"),
    clientSecret: credentialVariable(slug, "CLIENT_SECRET"),
  };
}

/**
 * A credential's variable name: the slug uppercased with every non-alphanumeric
 * replaced by `_`, then the suffix. A slug may start with a digit, which no
 * shell accepts as the first character of a name, so such a name gains a `_`.
 */
export function credentialVariable(slug: string, suffix: string): string {
  const name = `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/**
 * The `${{ NAME }}` reference written to a credential field, as
 * `idp-connection.json` requires: a whole-value placeholder, with no text
 * around it that would be rendered into the resolved credential.
 */
export function variableReference(name: string): string {
  return `\${{ ${name} }}`;
}

/**
 * The variable a `${{ NAME }}` reference names, or `undefined` when the value
 * is not one.
 *
 * A connection is editable, so the name it references need not be the one this
 * CLI would have chosen — a hand-written file may point at `ACME_SECRET`.
 * Publishing to a name derived from the slug instead would store the credential
 * where nothing reads it and report success.
 */
export function referencedVariable(value: string): string | undefined {
  return /^\$\{\{ *(\w+) *\}\}$/.exec(value.trim())?.[1];
}

/** Whether a stored value is a reference rather than a credential. */
export function isVariableReference(value: string): boolean {
  return referencedVariable(value) !== undefined;
}
