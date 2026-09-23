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
 * The environment-variable name a connection's `client_secret` references:
 * the slug uppercased with every non-alphanumeric replaced by `_`, suffixed
 * `_CLIENT_SECRET`. A slug may start with a digit, which no shell accepts as
 * the first character of a name, so such a name is prefixed with `_`.
 *
 * The connection file stores only the reference (`${{ NAME }}`), never the
 * value; the value lives in `.env.local`.
 */
export function clientSecretVariableName(slug: string): string {
  const name = `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_CLIENT_SECRET`;
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/**
 * The `${{ NAME }}` reference written to a connection's `client_secret`, as
 * `idp-connection.json` requires: a whole-value placeholder, with no text
 * around it that would be rendered into the resolved credential.
 */
export function clientSecretReference(slug: string): string {
  return `\${{ ${clientSecretVariableName(slug)} }}`;
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
 * Compose a connection document from a catalog entry and the prompted client
 * id. Pure: it returns the object `zitadel setup` writes to
 * `.zitadel/idps/<slug>.json`, and performs no IO.
 *
 * The secret is never a parameter — only the `${{ NAME }}` reference is
 * written, so a value cannot reach the committed file through this path.
 */
export function scaffoldConnection(options: {
  readonly provider: string;
  readonly clientId: string;
  readonly schemaProperties: Iterable<string>;
  /** Slug to write under; defaults to the catalog key. */
  readonly slug?: string;
  /** `$schema` pointer, relative to `.zitadel/idps/`. */
  readonly schemaRef?: string;
}): Record<string, unknown> {
  const entry = idpCatalogEntry(options.provider);
  const slug = options.slug ?? options.provider;
  const { protocol, oidc, oauth2, ...shared } = entry.protocol_block as Record<
    string,
    unknown
  >;
  const credentials = {
    client_id: options.clientId,
    client_secret: clientSecretReference(slug),
  };
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
      ? { oidc: { ...(oidc as object), ...credentials } }
      : { oauth2: { ...(oauth2 as object), ...credentials } }),
  };
}
