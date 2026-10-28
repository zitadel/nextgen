import { ZitadelError } from "../errors";
import { unscopedCommand } from "../suggestion";
import {
  CLI_CLIENT_ID,
  discoverAuthorization,
  type Fetch,
  type ServerAuthorization,
} from "./discovery";
import { listenForCallback } from "./loopback";
import { codeChallenge, newCodeVerifier, newState } from "./pkce";
import { readLogin, removeLogin, type StoredLogin, writeLogin } from "./store";

/** The token endpoint's answer (RFC 6749 §5.1). */
type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
};

/** What {@link signIn} needs from its caller. */
export type SignInInput = Readonly<{
  server: string;
  /** Hands the authorization URL to a person: open a browser, print it. */
  present: (authorizationUrl: string) => Promise<void> | void;
  /** How long to wait for the browser, in milliseconds. */
  timeoutMs: number;
  fetchFn?: Fetch;
  now?: () => Date;
}>;

/** A completed sign-in, before the CLI knows who signed in. */
export type Tokens = Readonly<{
  authorization: ServerAuthorization;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
}>;

/**
 * Signs a developer in to `server` with the authorization code flow, PKCE
 * (S256) and a loopback redirect on a free port (RFC 8252), as `gh auth
 * login` does: the browser does the signing in, through the server's own
 * login, and the CLI never sees a password.
 */
export async function signIn(input: SignInInput): Promise<Tokens> {
  const fetchFn = input.fetchFn ?? fetch;
  const now = input.now ?? (() => new Date());
  const authorization = await discoverAuthorization(input.server, fetchFn);
  const verifier = newCodeVerifier();
  const state = newState();
  const loopback = await listenForCallback(state);
  try {
    const url = new URL(authorization.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: CLI_CLIENT_ID,
      redirect_uri: loopback.redirectUri,
      response_type: "code",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      resource: authorization.resource,
    }).toString();
    await input.present(url.toString());

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ZitadelError("E_CANCELLED", "Sign-in timed out waiting for the browser.", {
              nextCommands: [unscopedCommand("login")],
            }),
          ),
        input.timeoutMs,
      );
    });
    const callback = await Promise.race([loopback.callback, timeout]).finally(() =>
      clearTimeout(timer),
    );
    if (!callback.ok) {
      throw new ZitadelError(
        "E_AUTH",
        `Sign-in failed: ${callback.description ?? callback.error}`,
        { details: { error: callback.error }, nextCommands: [unscopedCommand("login")] },
      );
    }
    // RFC 9207: a response from another issuer is a mix-up, not a sign-in.
    if (callback.iss !== undefined && callback.iss !== authorization.issuer) {
      throw new ZitadelError("E_AUTH", "Sign-in answered from an unexpected issuer.");
    }
    const tokens = await tokenRequest(fetchFn, authorization.tokenEndpoint, {
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: loopback.redirectUri,
      code_verifier: verifier,
      client_id: CLI_CLIENT_ID,
      resource: authorization.resource,
    });
    return toTokens(authorization, tokens, now());
  } finally {
    loopback.close();
  }
}

/** How long before expiry a stored access token is refreshed anyway. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * The developer's access token for `server`: the stored one while it lives,
 * else a fresh one from the refresh token, which rotates and is stored again.
 * `undefined` when nobody is signed in there. A refused refresh forgets the
 * sign-in and asks for a new one.
 */
export async function developerAccessToken(
  server: string,
  env: NodeJS.ProcessEnv,
  options: { fetchFn?: Fetch; now?: () => Date } = {},
): Promise<{ token: string; login: StoredLogin } | undefined> {
  const now = options.now ?? (() => new Date());
  const login = await readLogin(server, env);
  if (login === undefined) {
    return undefined;
  }
  if (Date.parse(login.access_token_expires_at) - EXPIRY_MARGIN_MS > now().getTime()) {
    return { token: login.access_token, login };
  }
  if (login.refresh_token === undefined) {
    await removeLogin(server, env);
    throw signInAgain(server, "Your sign-in expired.");
  }
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest(options.fetchFn ?? fetch, login.token_endpoint, {
      grant_type: "refresh_token",
      refresh_token: login.refresh_token,
      client_id: login.client_id,
      resource: login.resource,
    });
  } catch (error) {
    if (error instanceof ZitadelError && error.code === "E_AUTH") {
      await removeLogin(server, env);
      throw signInAgain(server, "Your sign-in was revoked or expired.");
    }
    throw error;
  }
  const refreshed: StoredLogin = {
    ...login,
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt(tokens, now()).toISOString(),
    ...(tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token }),
  };
  await writeLogin(server, refreshed, env);
  return { token: refreshed.access_token, login: refreshed };
}

/**
 * Revokes a stored sign-in's refresh token (RFC 7009), which ends its grant at
 * the server. Best effort: the caller forgets the sign-in either way.
 */
export async function revokeLogin(login: StoredLogin, fetchFn: Fetch = fetch): Promise<boolean> {
  if (login.revocation_endpoint === undefined || login.refresh_token === undefined) {
    return false;
  }
  try {
    const response = await fetchFn(login.revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: login.refresh_token,
        token_type_hint: "refresh_token",
        client_id: login.client_id,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Stores a sign-in for `server` with the user the API says it is. */
export function toStoredLogin(
  tokens: Tokens,
  user: StoredLogin["user"],
  signedInAt: Date,
): StoredLogin {
  const { authorization } = tokens;
  return {
    issuer: authorization.issuer,
    client_id: CLI_CLIENT_ID,
    resource: authorization.resource,
    token_endpoint: authorization.tokenEndpoint,
    ...(authorization.revocationEndpoint === undefined
      ? {}
      : { revocation_endpoint: authorization.revocationEndpoint }),
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.accessTokenExpiresAt.toISOString(),
    ...(tokens.refreshToken === undefined ? {} : { refresh_token: tokens.refreshToken }),
    user,
    signed_in_at: signedInAt.toISOString(),
  };
}

async function tokenRequest(
  fetchFn: Fetch,
  endpoint: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form),
    });
  } catch (error) {
    throw new ZitadelError("E_NETWORK", `Could not reach ${new URL(endpoint).origin}.`, {
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
  // biome-ignore lint/suspicious/noExplicitAny: an OAuth response, checked field by field below.
  const body: any = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `http_${response.status}`;
    const description =
      typeof body?.error_description === "string" ? body.error_description : undefined;
    throw new ZitadelError(
      response.status >= 500 ? "E_NETWORK" : "E_AUTH",
      `The token request failed: ${description ?? code}`,
      { details: { error: code } },
    );
  }
  if (typeof body?.access_token !== "string" || typeof body.token_type !== "string") {
    throw new ZitadelError("E_VALIDATION", "The token endpoint answered without an access token.");
  }
  if (body.token_type.toLowerCase() !== "bearer") {
    throw new ZitadelError("E_VALIDATION", `Unsupported token type ${body.token_type}.`);
  }
  return body as TokenResponse;
}

function toTokens(authorization: ServerAuthorization, tokens: TokenResponse, now: Date): Tokens {
  return {
    authorization,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: expiresAt(tokens, now),
    ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
  };
}

function expiresAt(tokens: TokenResponse, now: Date): Date {
  // Without expires_in, assume the shortest ADR 037 lifetime.
  const seconds = typeof tokens.expires_in === "number" ? tokens.expires_in : 300;
  return new Date(now.getTime() + seconds * 1000);
}

function signInAgain(server: string, message: string): ZitadelError {
  return new ZitadelError("E_AUTH", message, {
    hint: `Sign in to ${server} again.`,
    nextCommands: [unscopedCommand(`login --server ${server}`)],
  });
}
