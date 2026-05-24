import { type ClaudeAuth, forward } from "./forward.js";
import { isDebugEnabled } from "./utils/debug.js";
import { jsonResponse } from "./utils/response.js";

const PLACEHOLDER_BASE_URL = "http://placeholder.local";

/**
 * Web Standards request handler — the single source of truth for the
 * gateway's behaviour.
 *
 * Vercel's Node.js runtime calls this handler directly as a Web Standards
 * `(Request) => Promise<Response>` function.
 *
 * Auth precedence: OAuth (`ANTHROPIC_AUTH_TOKEN`) > API key (`ANTHROPIC_API_KEY`).
 * OAuth is preferred because it's billed against a Claude.ai / Max subscription
 * rather than per-token API spend.
 */
export default async function handle(request: Request): Promise<Response> {
	const oauthToken = process.env["ANTHROPIC_AUTH_TOKEN"];
	const refreshToken = process.env["ANTHROPIC_REFRESH_TOKEN"];
	const apiKey = process.env["ANTHROPIC_API_KEY"];

	const auth: ClaudeAuth | null =
		oauthToken !== undefined && oauthToken.length > 0
			? {
					mode: "oauth",
					token: oauthToken,
					...(refreshToken !== undefined && refreshToken.length > 0
						? { refreshToken }
						: {}),
				}
			: apiKey !== undefined && apiKey.length > 0
				? { mode: "apiKey", key: apiKey }
				: null;
	if (auth === null) {
		return jsonResponse(
			{
				error: "configuration_error",
				message:
					"Gateway has no upstream credential. Set ANTHROPIC_AUTH_TOKEN (OAuth) or ANTHROPIC_API_KEY.",
			},
			500,
		);
	}

	const url = new URL(request.url, PLACEHOLDER_BASE_URL);
	return forward({
		request,
		pathname: url.pathname,
		search: url.search.slice(1),
		auth,
		onDebug: isDebugEnabled()
			? ({ upstreamUrl, upstreamStatus }) => {
					console.error(`[gateway] → ${upstreamUrl}`);
					console.error(`[gateway] ← upstream status: ${upstreamStatus}`);
				}
			: undefined,
	});
}
