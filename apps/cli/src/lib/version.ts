declare const __ZITADEL_CLI_VERSION__: string;

/**
 * The CLI's own version string, surfaced by `--version` and embedded in
 * generated metadata. The bundler replaces `__ZITADEL_CLI_VERSION__` at build
 * time with the published package version; the `0.0.0` fallback keeps the
 * value defined when running from source (tests, ts-node) where no injection
 * has occurred.
 */
export const CLI_VERSION: string =
  typeof __ZITADEL_CLI_VERSION__ !== "undefined" ? __ZITADEL_CLI_VERSION__ : "0.0.0";
