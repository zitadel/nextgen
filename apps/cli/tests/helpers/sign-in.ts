import { writeLogin } from "../../src/lib/login/store";

/** Whom a sign-in {@link aSignInTo} keeps names. */
export const DEVELOPER = { id: "user_dev", identifier: "dev@acme.com" } as const;

/** The access token a sign-in {@link aSignInTo} keeps presents, told apart from any secret. */
export const DEVELOPER_TOKEN = "login_access_token";

/**
 * Keeps a sign-in to `server` in `configHome`, as `zitadel login` keeps one,
 * with a token that lives for an hour so no run refreshes it, and returns the
 * environment a run reads it from. A test passes its own fresh directory, so
 * the sign-in ends with the test.
 */
export async function aSignInTo(server: string, configHome: string): Promise<NodeJS.ProcessEnv> {
  const env = { XDG_CONFIG_HOME: configHome };
  await writeLogin(
    server,
    {
      issuer: server,
      client_id: "cli",
      resource: `${server}/api/v1`,
      token_endpoint: `${server}/oauth/proj_platform/token`,
      access_token: DEVELOPER_TOKEN,
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      refresh_token: "login_refresh_token",
      user: { ...DEVELOPER },
      signed_in_at: new Date().toISOString(),
    },
    env,
  );
  return env;
}
