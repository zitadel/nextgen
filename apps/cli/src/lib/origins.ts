/** One of a project's origins, as the API returns it and `.zitadel/secret` records it. */
export type ProjectOrigin = Readonly<{ pattern: string; kind: string }>;

/**
 * The stored pattern of `issuer` when a project holds it as a preview origin
 * and has no primary one, or `undefined`.
 *
 * That is how `zitadel setup` 0.1.0 registered the app's own URL; setup now
 * registers it as primary. A deploy lands only on primary origins, so such a
 * project has nowhere to deploy, and `origin add <issuer> --kind primary` is
 * refused because the pattern is already stored with another kind
 * (`origin.kind_conflict`): it has to be removed and added back as primary.
 */
export function issuerHeldAsPreview(
  origins: ReadonlyArray<ProjectOrigin>,
  issuer: string,
): string | undefined {
  if (origins.some((origin) => origin.kind === "primary")) {
    return undefined;
  }
  const wanted = originOf(issuer);
  return origins.find((origin) => origin.kind === "preview" && originOf(origin.pattern) === wanted)
    ?.pattern;
}

/** The origins `.zitadel/secret` records, in the shape the API returns them. */
export function recordedOrigins(secret: {
  primary_origins: readonly string[];
  preview_origins: readonly string[];
}): ProjectOrigin[] {
  return [
    ...secret.primary_origins.map((pattern) => ({ pattern, kind: "primary" })),
    ...secret.preview_origins.map((pattern) => ({ pattern, kind: "preview" })),
  ];
}

/**
 * A URL as its origin, the form a stored pattern takes, so an issuer written
 * `http://localhost:3000/` matches the stored `http://localhost:3000`. A value
 * that is not a URL is returned as written.
 */
export function originOf(value: string): string {
  return URL.canParse(value) ? new URL(value).origin : value;
}
