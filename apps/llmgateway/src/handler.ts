import { forward, type UpstreamAuth } from "./forward.js";
import { isDebugEnabled, truncateForLog } from "./utils/debug.js";

const PLACEHOLDER_BASE_URL = "http://placeholder.local";

/**
 * Web Standards request handler — the single source of truth for the
 * gateway's behaviour.
 *
 * This function is NOT called directly by Vercel. Vercel's Node.js runtime
 * always invokes serverless functions as `(IncomingMessage, ServerResponse)`;
 * the `vercel-adapter.ts` bridge translates that signature into a `Request`
 * and calls this function, then pipes the `Response` back.
 *
 * Auth precedence: OAuth (`ANTHROPIC_AUTH_TOKEN`) > API key (`ANTHROPIC_API_KEY`).
 * OAuth is preferred because it's billed against a Claude.ai / Max subscription
 * rather than per-token API spend.
 *
 * The `?path=` query parameter injected by Vercel's catch-all routing is
 * stripped by the adapter before this function is called; handler-side code
 * never sees it.
 */
export default async function handle(request: Request): Promise<Response> {
	const oauthToken = process.env["ANTHROPIC_AUTH_TOKEN"];
	const apiKey = process.env["ANTHROPIC_API_KEY"];

	const auth: UpstreamAuth | null =
		oauthToken !== undefined && oauthToken.length > 0
			? { mode: "oauth", token: oauthToken }
			: apiKey !== undefined && apiKey.length > 0
				? { mode: "apiKey", key: apiKey }
				: null;
	if (auth === null) {
		return new Response(
			JSON.stringify({
				error: "configuration_error",
				message:
					"Gateway has no upstream credential. Set ANTHROPIC_AUTH_TOKEN (OAuth) or ANTHROPIC_API_KEY.",
			}),
			{ status: 500, headers: { "content-type": "application/json" } },
		);
	}

	const url = new URL(request.url, PLACEHOLDER_BASE_URL);
	return forward({
		request,
		pathname: url.pathname,
		search: url.search,
		auth,
		onDebug: isDebugEnabled()
			? ({ upstreamUrl, mutatedBody, upstreamStatus }) => {
					process.stderr.write(`[gateway] → ${upstreamUrl}\n`);
					process.stderr.write(`[gateway] ← upstream status: ${upstreamStatus}\n`);
					if (mutatedBody !== undefined) {
						process.stderr.write(
							`[gateway] mutated body:\n${truncateForLog(JSON.stringify(mutatedBody, null, 2))}\n`,
						);
					}
				}
			: undefined,
	});
}
