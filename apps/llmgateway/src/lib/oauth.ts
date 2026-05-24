/**
 * Anthropic OAuth 2.0 token refresh.
 *
 * The gateway stores a long-lived refresh token in `ANTHROPIC_REFRESH_TOKEN`.
 * When the short-lived access token (`ANTHROPIC_AUTH_TOKEN`) expires Anthropic
 * returns HTTP 401; `forward.ts` catches that, calls {@link refreshOAuthToken},
 * and retries the original request once with the new access token.
 */

const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

/**
 * The public OAuth client-id for the Claude Code application.
 * This is not a secret — it identifies the application, not the user.
 */
const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/** Both tokens returned by a successful refresh. */
export interface OAuthTokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
}

/**
 * Exchange a refresh token for a new access/refresh token pair.
 *
 * Throws a descriptive `Error` on any failure (non-2xx response, network
 * error, unexpected response shape). Callers decide whether to propagate or
 * swallow the error.
 *
 * @param currentRefreshToken - The long-lived refresh token stored in env.
 * @param fetchImpl - Injectable fetch for testing; defaults to global `fetch`.
 */
export async function refreshOAuthToken(
	currentRefreshToken: string,
	fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenPair> {
	const res = await fetchImpl(ANTHROPIC_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: currentRefreshToken,
			client_id: ANTHROPIC_OAUTH_CLIENT_ID,
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "(no body)");
		throw new Error(`OAuth token refresh failed with status ${res.status}: ${body}`);
	}

	const data = (await res.json()) as { readonly access_token?: unknown; readonly refresh_token?: unknown };

	if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
		throw new Error(
			`OAuth token refresh returned unexpected shape: access_token=${typeof data.access_token}, refresh_token=${typeof data.refresh_token}`,
		);
	}

	return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
