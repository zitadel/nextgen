/**
 * The Zitadel server the CLI targets when nothing names one: no `--server`, no
 * `ZITADEL_API_BASE` and no `server` in `zitadel.json`. It is the one place the
 * CLI names a hosted server; every default, example, hint and host check reads it.
 */
export const SERVER = "https://preview.zitadel.com";
