/**
 * The provider catalog `zitadel setup` scaffolds identity-provider connection
 * files from. Following "vendor knowledge is data" (see
 * `docs/design/idp/1-resource-model.md`), everything the CLI needs to write a
 * working connection — endpoints, scopes, the claim table, the vendor console
 * to send the developer to — is a bundled table rather than code, so
 * scaffolding works offline and adding a provider is a data change.
 *
 * The table deliberately does not carry: `client_id` (prompted), the slug (the
 * entry's key), the client-secret variable name (derived from the slug by
 * {@link clientSecretVariableName}), or `provisioning` (a scaffold default, not
 * vendor knowledge).
 *
 * The bundled table ages with the installed CLI, so a vendor change reaches new
 * scaffolds only through a package upgrade. That risk stops at scaffold time:
 * the written file is tenant-editable, OIDC endpoints resolve through discovery
 * at runtime, and the server validates every deploy.
 */
import idpCatalogTable from "../defaults/idp-catalog.json" with { type: "json" };

/**
 * Whether the vendor accepts many redirect URIs on a single client, or needs a
 * separate application per environment. Surfaced during the announce step so
 * the developer registers the right thing.
 */
export type CallbackGuidance = "multi_uri_client" | "app_per_environment";

/**
 * One vendor's knowledge. `protocol_block` is merged into the scaffolded
 * connection verbatim; the identity-bearing fields (`slug`, `client_id`,
 * `client_secret`, `claim_mapping`, `provisioning`) are composed at scaffold
 * time and never stored here.
 */
export type IdpCatalogEntry = {
  readonly display_name: string;
  readonly template: string;
  readonly console_url: string;
  readonly docs_url: string;
  readonly callback_guidance: CallbackGuidance;
  readonly protocol_block: Readonly<Record<string, unknown>> & {
    readonly protocol: "oidc" | "oauth2";
  };
  /** Schema property name → the provider's documented claim name. */
  readonly claim_table: Readonly<Record<string, string>>;
};

/**
 * The catalog keyed by each entry's default slug. The `$schema` pointer the
 * JSON file carries for editor validation is not a provider and is stripped
 * here, so callers can enumerate keys without special-casing it.
 */
export const IDP_CATALOG: Readonly<Record<string, IdpCatalogEntry>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(idpCatalogTable as Record<string, unknown>).filter(
        ([key]) => key !== "$schema",
      ),
    ) as Record<string, IdpCatalogEntry>,
  );

/** Catalog keys, in table order. Each doubles as the default connection slug. */
export const IDP_PROVIDERS: ReadonlyArray<string> = Object.freeze(
  Object.keys(IDP_CATALOG),
);

/**
 * Look up one entry, rejecting keys the table does not define.
 *
 * Uses an own-property check: indexing a plain object with an arbitrary string
 * would let `"__proto__"`/`"constructor"` resolve through the prototype chain
 * and bypass the unknown-provider error.
 */
export function idpCatalogEntry(provider: string): IdpCatalogEntry {
  if (!Object.hasOwn(IDP_CATALOG, provider)) {
    throw new Error(
      `unknown identity provider ${JSON.stringify(provider)} (known providers: ${IDP_PROVIDERS.join(", ")})`,
    );
  }
  return IDP_CATALOG[provider] as IdpCatalogEntry;
}

/**
 * A variable name for one of a connection's credentials: the slug uppercased
 * with every non-alphanumeric replaced by `_`, then the suffix. A slug may
 * start with a digit, which no shell accepts as the first character of a name,
 * so such a name is prefixed with `_`.
 */
function credentialVariableName(slug: string, suffix: string): string {
  const name = `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/** The variable a connection's `client_secret` references. */
export function clientSecretVariableName(slug: string): string {
  return credentialVariableName(slug, "CLIENT_SECRET");
}

/** The variable a connection's `client_id` references. */
export function clientIdVariableName(slug: string): string {
  return credentialVariableName(slug, "CLIENT_ID");
}

/**
 * The `${{ NAME }}` reference written to a credential field, as
 * `idp-connection.json` requires: a whole-value placeholder, with no text
 * around it that would be rendered into the resolved credential.
 */
function variableReference(name: string): string {
  return `\${{ ${name} }}`;
}

/**
 * Whether a stored value is a `${{ NAME }}` reference rather than a credential.
 *
 * The one place that knows the syntax is {@link variableReference}, which
 * writes it; this is its counterpart, so a caller deciding what a connection
 * actually holds does not have to recognise the shape itself. Mirrors the
 * engine's own placeholder grammar (`internal/domain/variable_replace.go`):
 * a whole-value placeholder naming one variable, with optional inner spacing.
 */
export function isVariableReference(value: string): boolean {
  return referencedVariable(value) !== undefined;
}

/**
 * The variable a `${{ NAME }}` reference names, or `undefined` when the value
 * is not one.
 *
 * A connection is editable, so the name it references need not be the one this
 * CLI would have chosen — a hand-written file may point at `ACME_SECRET`.
 * Publishing to a name derived from the slug instead would store the
 * credential where nothing reads it and report success.
 */
export function referencedVariable(value: string): string | undefined {
  return /^\$\{\{ *(\w+) *\}\}$/.exec(value.trim())?.[1];
}

/** The reference written to a connection's `client_secret`. */
export function clientSecretReference(slug: string): string {
  return variableReference(clientSecretVariableName(slug));
}

/** The reference written to a connection's `client_id`. */
export function clientIdReference(slug: string): string {
  return variableReference(clientIdVariableName(slug));
}

/**
 * The `claim_mapping` for a connection: the catalog rows whose schema property
 * the target schema actually defines. Properties the claim table does not know
 * stay unmapped, and the setup summary names any required ones that got no
 * mapping so the developer can add rows or accept the collection step.
 */
export function claimMappingFor(
  entry: IdpCatalogEntry,
  schemaProperties: Iterable<string>,
): Record<string, string> {
  const defined = new Set(schemaProperties);
  return Object.fromEntries(
    Object.entries(entry.claim_table).filter(([property]) =>
      defined.has(property),
    ),
  );
}

/**
 * Where a connection's OIDC endpoints point, when they are not the catalog's.
 *
 * Only for standing a provider up locally: a mock on `localhost` speaks the
 * same protocol as the real vendor, and pointing at it should be a flag rather
 * than a hand edit of the document afterwards.
 *
 * Only the issuer: the engine accepts a connection naming every endpoint or
 * none, so a stand-in names none and its discovery document supplies them,
 * exactly as the vendor's does.
 */
export type ConnectionEndpoints = {
  readonly issuer?: string;
};

/** The issuer a catalog entry points at, for use as a prompt's default. */
export function catalogIssuer(provider: string): string {
  const block = idpCatalogEntry(provider).protocol_block as {
    oidc?: { issuer?: string };
    oauth2?: { issuer?: string };
  };
  return block.oidc?.issuer ?? block.oauth2?.issuer ?? "";
}


/**
 * The endpoint keys to write, which is the issuer or nothing.
 *
 * An issuer equal to the catalog's changes nothing, so the vendor's template
 * stands. A different one is written alone: the engine accepts a connection
 * naming every endpoint or none (`requireAllOrNoEndpoints`), and it needs four
 * -- authorization, token, `jwks_uri`, and `userinfo_endpoint` unless id_token
 * mapping is on. Naming a subset is rejected as `idp.endpoints_partial`, so
 * the issuer alone is both the smaller and the only valid choice; a stand-in
 * serves its own discovery document just as the vendor does.
 */
function endpointOverrides(
  endpoints: ConnectionEndpoints | undefined,
  catalogsIssuer: string,
): Record<string, string> {
  const issuer = endpoints?.issuer;
  if (issuer === undefined || issuer === "" || issuer === catalogsIssuer) {
    return {};
  }
  return { issuer };
}

/**
 * Compose a connection document from a catalog entry. Pure: it returns the
 * object `zitadel setup` writes to `.zitadel/idps/<slug>.json`, and performs
 * no IO.
 *
 * Neither credential is written into the document. Both are `${{ NAME }}`
 * references to project variables, for different reasons:
 *
 * - The **secret** must not be committed at all. The file goes into git and
 *   config revisions are immutable, so a literal could never be scrubbed.
 * - The **client id** is public and could be a literal, but each environment
 *   registers its own OAuth application, so a literal would force one
 *   connection file per environment and defeat the indirection. The API's
 *   own schema says as much (`idp-connection.yaml`).
 *
 * Neither value is a parameter, so neither can reach the committed file
 * through this path. Both are published as project variables instead — the
 * client id as an ordinary one, readable afterwards; the secret as a secret.
 */
export function scaffoldConnection(options: {
  readonly provider: string;
  readonly schemaProperties: Iterable<string>;
  /** Slug to write under; defaults to the catalog key. */
  readonly slug?: string;
  /** `$schema` pointer, relative to `.zitadel/idps/`. */
  readonly schemaRef?: string;
  /** Point the connection somewhere other than the vendor (local testing). */
  readonly endpoints?: ConnectionEndpoints;
}): Record<string, unknown> {
  const entry = idpCatalogEntry(options.provider);
  const slug = options.slug ?? options.provider;
  const { protocol, oidc, oauth2, ...shared } = entry.protocol_block as Record<
    string,
    unknown
  >;
  const credentials = {
    client_id: clientIdReference(slug),
    client_secret: clientSecretReference(slug),
  };
  // Last, so an override replaces the template's issuer rather than being
  // replaced by it.
  const overrides = endpointOverrides(options.endpoints, catalogIssuer(options.provider));
  const claimMapping = claimMappingFor(entry, options.schemaProperties);

  return {
    ...(options.schemaRef ? { $schema: options.schemaRef } : {}),
    slug,
    protocol,
    template: entry.template,
    display_name: entry.display_name,
    ...shared,
    ...(Object.keys(claimMapping).length > 0
      ? { claim_mapping: claimMapping }
      : {}),
    provisioning: { creation: "auto" },
    ...(protocol === "oidc"
      ? { oidc: { ...(oidc as object), ...credentials, ...overrides } }
      : { oauth2: { ...(oauth2 as object), ...credentials, ...overrides } }),
  };
}
