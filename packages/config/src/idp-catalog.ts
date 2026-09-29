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
  /**
   * The vendor's own OAuth endpoints. Reference only — never written to a
   * connection, which names the issuer and lets discovery resolve them. They
   * exist so {@link derivedEndpoints} can offer a default that keeps the
   * vendor's paths when a stand-in is hosted somewhere else.
   */
  readonly reference_endpoints?: Readonly<{
    authorization_endpoint: string;
    token_endpoint: string;
  }>;
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
 * `issuer` is usually the only one needed. The engine derives
 * `<issuer>/authorize` and `<issuer>/token` when the endpoints are absent, and
 * the catalog templates carry no explicit endpoints for exactly that reason.
 * The two overrides exist for a stand-in whose paths differ.
 */
export type ConnectionEndpoints = {
  readonly issuer?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
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
 * The vendor's own endpoint paths, moved onto `issuer`'s origin.
 *
 * A stand-in for a provider should answer on the provider's paths and differ
 * only in where it is hosted — that is the whole point of testing against one.
 * So `https://accounts.google.com/o/oauth2/v2/auth` becomes
 * `http://localhost:9100/o/oauth2/v2/auth`, and the developer confirms a
 * default that is already right instead of correcting a generic guess.
 *
 * Falls back to `<issuer>/authorize` and `<issuer>/token` for an entry that
 * names no reference endpoints, which is what the engine derives when a
 * connection names none either.
 */
export function derivedEndpoints(
  issuer: string,
  provider?: string,
): { authorizationEndpoint: string; tokenEndpoint: string } {
  const base = issuer.replace(/\/$/, "");
  const reference = provider === undefined ? undefined : idpCatalogEntry(provider).reference_endpoints;
  const onIssuer = (vendor: string | undefined, fallback: string): string => {
    if (vendor === undefined) {
      return `${base}/${fallback}`;
    }
    try {
      return `${base}${new URL(vendor).pathname}`;
    } catch {
      return `${base}/${fallback}`;
    }
  };
  return {
    authorizationEndpoint: onIssuer(reference?.authorization_endpoint, "authorize"),
    tokenEndpoint: onIssuer(reference?.token_endpoint, "token"),
  };
}

/**
 * The endpoint keys to write.
 *
 * An issuer equal to the catalog's changes nothing, so nothing is written and
 * the vendor's own template stands. That case matters: the catalog names no
 * endpoints for a vendor on purpose, because they are resolved from its
 * discovery document, and Google's are not `<issuer>/authorize` and
 * `<issuer>/token` at all. Writing a guess there would break the connection
 * that needs no help.
 *
 * Once the issuer points somewhere else, all three are written. The connection
 * then says where it goes rather than leaving a reader to work out what the
 * engine would derive, and `idp-connection.yaml` treats a connection that
 * names every endpoint as authoritative instead of consulting discovery --
 * which a stand-in may not serve.
 */
function endpointOverrides(
  endpoints: ConnectionEndpoints | undefined,
  provider: string,
  catalogsIssuer: string,
): Record<string, string> {
  const issuer = endpoints?.issuer;
  if (issuer === undefined || issuer === "" || issuer === catalogsIssuer) {
    return {};
  }
  const derived = derivedEndpoints(issuer, provider);
  return {
    issuer,
    authorization_endpoint: endpoints?.authorizationEndpoint || derived.authorizationEndpoint,
    token_endpoint: endpoints?.tokenEndpoint || derived.tokenEndpoint,
  };
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
  const overrides = endpointOverrides(options.endpoints, options.provider, catalogIssuer(options.provider));
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
