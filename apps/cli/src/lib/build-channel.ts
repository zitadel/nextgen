/**
 * Whether this CLI was built from source or shipped as a release.
 *
 * The channel is stamped into the bundle at build time: `development` for
 * every contributor and CI build, `production` only from the release pipeline
 * (see `apps/cli/tsdown.config.ts`). It is the one honest way for the CLI to
 * know it is being used while it is being *developed*, rather than by someone
 * who installed it — a flag would have to be typed by the very people who
 * should not have to know it exists, and an env var would be set once and then
 * forgotten in a shell that later runs a published CLI.
 *
 * Telemetry reads the same stamp for a different purpose, and layers its own
 * env overrides on top; those overrides deliberately do not reach here. Which
 * Mixpanel project events land in is not a statement about whether this binary
 * is a development build.
 */

declare const __ZITADEL_TELEMETRY_CHANNEL__: string | undefined;

/**
 * The channel stamped into this bundle, lowercased, or `""` in an unbundled
 * run — a unit test importing a module directly, where tsdown's `define` never
 * replaced the identifier. The `typeof` guard is what keeps that from throwing
 * a ReferenceError.
 */
export function buildStampedChannel(): string {
  return typeof __ZITADEL_TELEMETRY_CHANNEL__ === "string"
    ? __ZITADEL_TELEMETRY_CHANNEL__.trim().toLowerCase()
    : "";
}

/**
 * Whether this is a development build: anything that is not a stamped release.
 *
 * Unstamped runs count as development, which is the safe direction — the only
 * builds that answer `false` are the ones the release pipeline produced, so a
 * developer affordance can never appear in a published CLI by accident.
 */
export function isDevelopmentBuild(): boolean {
  return buildStampedChannel() !== "production";
}
