/**
 * The Zitadel server the CLI targets when nothing names one: no `--server`,
 * no `ZITADEL_API_BASE` and no `server` in `zitadel.json`. The console reads
 * it too, to leave `--server` out of a command that would target it anyway.
 *
 * Its own entry point with no Node imports, so a browser bundle can take it.
 */
export const DEFAULT_SERVER = "https://preview.zitadel.com";
