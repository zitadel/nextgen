import { injectSystemPrompt } from "./inject.js";
import { ClaudeService, type ClaudeAuth } from "./lib/claude.js";
import { refreshOAuthToken } from "./lib/oauth.js";
import { ProxyService } from "./lib/proxy.js";
import { isPlainObject, tryParseJson } from "./utils/json.js";
import { jsonResponse } from "./utils/response.js";

export type { ClaudeAuth } from "./lib/claude.js";

const ANTHROPIC_API_VERSION_PREFIX = "v1";
const MESSAGES_ENDPOINT = "messages";
const COUNT_TOKENS_ENDPOINT = "count_tokens";

const ALLOWED_UPSTREAM_PATHS: ReadonlyArray<string> = [
	`/${ANTHROPIC_API_VERSION_PREFIX}/${MESSAGES_ENDPOINT}`,
	`/${ANTHROPIC_API_VERSION_PREFIX}/${MESSAGES_ENDPOINT}/${COUNT_TOKENS_ENDPOINT}`,
];

/**
 * Extract the path segments after `/v1/` from a URL pathname. Handles both
 * the externally-visible path (`/v1/messages`) and the Vercel-internal
 * post-rewrite path (`/api/v1/messages`).
 */
export function extractV1PathSegments(pathname: string): ReadonlyArray<string> {
	const parts = pathname
		.replace(/^\/+/, "")
		.split("/")
		.filter((p) => p.length > 0);
	if (parts[0] === "api" && parts[1] === ANTHROPIC_API_VERSION_PREFIX) {
		return parts.slice(2);
	}
	if (parts[0] === ANTHROPIC_API_VERSION_PREFIX) {
		return parts.slice(1);
	}
	return parts;
}

/**
 * Parse the inbound body and, when targeted at the exact `/v1/messages`
 * endpoint, inject the guardrail (plus the Claude Code identifier in OAuth
 * mode) into the system field.
 *
 * Sub-endpoints like `/v1/messages/count_tokens` are NOT injected — they
 * share the request body shape but are informational, and injection would
 * inflate their reported token counts.
 *
 * Returns the parsed (and possibly mutated) body and the serialised JSON
 * ready to send upstream. `null` is returned when parsing fails so callers
 * can translate to a 400.
 */
export function prepareBody(
	rawJson: string,
	pathParts: ReadonlyArray<string>,
	auth: ClaudeAuth,
): { readonly mutatedBody: unknown; readonly serialised: string } | null {
	if (rawJson.length === 0) {
		return { mutatedBody: undefined, serialised: "" };
	}

	const parsed = tryParseJson(rawJson);
	if (!parsed.ok) {
		return null;
	}

	const isExactMessagesEndpoint = pathParts.length === 1 && pathParts[0] === MESSAGES_ENDPOINT;

	if (isExactMessagesEndpoint && isPlainObject(parsed.value)) {
		const mutated = injectSystemPrompt(parsed.value, {
			prependClaudeCodeIdentifier: auth.mode === "oauth",
		});
		return { mutatedBody: mutated, serialised: JSON.stringify(mutated) };
	}
	return { mutatedBody: parsed.value, serialised: rawJson };
}

/**
 * Forward an inbound `/v1/...` request to `https://api.anthropic.com/v1/...`,
 * mutating the system prompt for `/v1/messages` and rewriting authentication
 * per the configured upstream strategy. The upstream response body is
 * streamed back unchanged.
 *
 * Behaviour:
 *
 * - Only `/v1/messages` and `/v1/messages/count_tokens` are accepted;
 *   all other paths return `404 not_found`.
 * - GET/HEAD requests pass through with only auth + version header rewriting.
 * - Non-2xx upstream responses are forwarded verbatim so the calling SDK can
 *   apply its own 429/5xx detection.
 * - Invalid JSON in the inbound body returns `400 invalid_json` without
 *   contacting the upstream.
 */
export async function forward(args: {
	readonly request: Request;
	readonly pathname: string;
	readonly search: string;
	readonly auth: ClaudeAuth;
	readonly fetchImpl?: typeof fetch;
	readonly onDebug?: (info: {
		readonly upstreamUrl: string;
		readonly upstreamStatus: number;
	}) => void;
}): Promise<Response> {
	const pathParts = extractV1PathSegments(args.pathname);

	if (!ALLOWED_UPSTREAM_PATHS.includes(`/${ANTHROPIC_API_VERSION_PREFIX}/${pathParts.join("/")}`)) {
		return jsonResponse({ error: "not_found", message: "Endpoint not supported" }, 404);
	}

	const { onDebug } = args;

	const method = args.request.method.toUpperCase();
	const hasBody = method !== "GET" && method !== "HEAD";
	const rawBody = hasBody ? await args.request.text() : undefined;

	const onBody =
		rawBody !== undefined
			? (raw: string): string | null => {
					const prepared = prepareBody(raw, pathParts, args.auth);
					return prepared === null ? null : prepared.serialised;
				}
			: undefined;

	const proxyService = new ProxyService({
		allowedUrls: ALLOWED_UPSTREAM_PATHS,
		fetchImpl: args.fetchImpl,
	});

	const claudeService = new ClaudeService({
		auth: args.auth,
		transport: proxyService,
	});

	const callOptions = {
		pathSegments: pathParts,
		search: args.search,
		method,
		requestHeaders: args.request.headers,
		body: rawBody,
		onBody,
		onDebug: onDebug
			? (url: string, status: number) => onDebug({ upstreamUrl: url, upstreamStatus: status })
			: undefined,
	} as const;

	const firstResponse = await claudeService.call(callOptions);

	// Auto-refresh: when Anthropic returns 401 and we have a refresh token,
	// exchange it for a new access token and retry the request once. If the
	// refresh itself fails, the original 401 is returned to the caller.
	if (
		firstResponse.status === 401 &&
		args.auth.mode === "oauth" &&
		args.auth.refreshToken !== undefined
	) {
		const newTokens = await refreshOAuthToken(args.auth.refreshToken, args.fetchImpl).catch(
			() => null,
		);

		if (newTokens !== null) {
			// Release the upstream connection only once we know we will retry —
			// if refresh failed we return firstResponse intact so the caller
			// still gets Anthropic's original error body.
			await firstResponse.body?.cancel().catch(() => {});

			const refreshedService = new ClaudeService({
				auth: {
					mode: "oauth",
					token: newTokens.accessToken,
					refreshToken: newTokens.refreshToken,
				},
				transport: proxyService,
			});
			return refreshedService.call(callOptions);
		}
	}

	return firstResponse;
}
