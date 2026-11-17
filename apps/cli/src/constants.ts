/**
 * The server `ZitadelRuntime.resolve()` returns when no `--server` is given. A
 * command that talks to a project resolves its server from `ZITADEL_URL`
 * instead, as `Environment` reads it. This is the one place the CLI names a
 * hosted server; every default, example, hint and host check reads it.
 */
export const SERVER = "https://preview.zitadel.com";
