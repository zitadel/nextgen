/**
 * Whether this is a contributor's development run.
 *
 * The CLI ships as a single generic build — nothing is stamped into the bundle
 * — so development mode is an explicit runtime opt-in via `ZITADEL_CLI_DEV`. A
 * published CLI never has it set, so developer-only affordances (such as the
 * local-IdP issuer prompt in `setup`/`auth-method sso enable`) can never appear
 * for someone who installed the CLI. Contributors set `ZITADEL_CLI_DEV=1` when
 * they want them; everything else — real installs, scripted runs, CI — is a
 * normal run.
 */
export function isDevelopmentBuild(): boolean {
  const flag = process.env.ZITADEL_CLI_DEV?.trim().toLowerCase();
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}
