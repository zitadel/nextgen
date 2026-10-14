import idpConnectionMetaSchema from "../../meta-schemas/idp-connection.json" with { type: "json" };

/**
 * The limits a connection document must meet, read out of the generated
 * meta-schema rather than restated here.
 *
 * That file is generated from the OpenAPI YAML the server embeds, which makes it
 * what the server will enforce. A rule written out by hand in the CLI would go
 * on accepting what a changed server rule refuses, and the refusal would come on
 * apply, after the files are written.
 */
type Limits = {
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
};

function limitsAt(path: readonly string[]): Limits {
  let level: unknown = idpConnectionMetaSchema;
  for (const key of path) {
    const properties = (level as { properties?: Record<string, unknown> } | undefined)?.properties;
    level = properties?.[key];
  }
  if (typeof level !== "object" || level === null) {
    // Silently accepting everything would be the worst outcome: a prompt would
    // go on reporting success for connections the server refuses.
    throw new Error(`idp-connection.json no longer describes properties.${path.join(".")}`);
  }
  return level as Limits;
}

/** What `slug`, `display_name` and `oidc.issuer` must satisfy. */
export const connectionLimits = {
  slug: limitsAt(["slug"]),
  displayName: limitsAt(["display_name"]),
  issuer: limitsAt(["oidc", "issuer"]),
} as const;
