import { injectSystemPrompt } from "./inject.js";
import { effectiveHopByHopHeaders, filterHeaders, proxy } from "./lib/proxy.js";
import { isPlainObject, tryParseJson } from "./utils/json.js";

/**
 * Upstream credential strategy. Exactly one variant is resolved from the
 * gateway environment and passed to {@link forward} on every request.
 *
 * - `oauth`: bearer token issued by claude.ai (e.g. via `claude /login` for
 *   Claude Max subscribers). Billed against the user's subscription quota.
 *   Triggers the {@link ./inject.ts#CLAUDE_CODE_IDENTIFIER_TEXT} prefix and
 *   the `anthropic-beta: oauth-2025-04-20` header. Set via `ANTHROPIC_AUTH_TOKEN`.
 * - `apiKey`: a `sk-ant-…` key from `console.anthropic.com`. Billed
 *   per-token. Set via `ANTHROPIC_API_KEY`.
 */
export type UpstreamAuth =
	| { readonly mode: "oauth"; readonly token: string }
	| { readonly mode: "apiKey"; readonly key: string };

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION_PREFIX = "v1";
const ANTHROPIC_BETA_QUERY_PARAM = "beta";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const MESSAGES_ENDPOINT = "messages";

const INBOUND_RESERVED_HEADERS: ReadonlySet<string> = new Set([
	"authorization",
	"host",
	"content-length",
]);

const OUTBOUND_RESERVED_HEADERS: ReadonlySet<string> = new Set([
	"content-encoding",
	"content-length",
]);

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
 * Compose the absolute Anthropic upstream URL. Strips the `beta` query
 * parameter Anthropic's gateway-fronting endpoints reject.
 */
export function buildUpstreamUrl(pathParts: ReadonlyArray<string>, inboundSearch: string): string {
	const suffix = pathParts.join("/");
	const upstream = new URL(`${ANTHROPIC_API_ORIGIN}/${ANTHROPIC_API_VERSION_PREFIX}/${suffix}`);
	const params = new URLSearchParams(inboundSearch);
	params.delete(ANTHROPIC_BETA_QUERY_PARAM);
	const qs = params.toString();
	return qs.length > 0 ? `${upstream.toString()}?${qs}` : upstream.toString();
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
	auth: UpstreamAuth,
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
 * Return a fresh `Headers` with the appropriate upstream auth applied.
 *
 * - OAuth: `Authorization: Bearer <token>` + ensure
 *   `anthropic-beta: oauth-2025-04-20` is present.
 * - API key: `x-api-key: <key>`.
 *
 * Always ensures `anthropic-version` is set (defaulting to
 * {@link DEFAULT_ANTHROPIC_VERSION} when missing).
 */
export function applyAuth(input: Headers, auth: UpstreamAuth): Headers {
	const out = new Headers(input);

	if (auth.mode === "oauth") {
		out.set("authorization", `Bearer ${auth.token}`);
		const existingBeta = out.get("anthropic-beta");
		if (existingBeta === null) {
			out.set("anthropic-beta", ANTHROPIC_OAUTH_BETA);
		} else {
			const alreadyPresent = existingBeta
				.split(",")
				.map((s) => s.trim())
				.includes(ANTHROPIC_OAUTH_BETA);
			if (!alreadyPresent) {
				out.set("anthropic-beta", `${existingBeta},${ANTHROPIC_OAUTH_BETA}`);
			}
		}
	} else {
		out.set("x-api-key", auth.key);
	}

	if (!out.has("anthropic-version")) {
		out.set("anthropic-version", DEFAULT_ANTHROPIC_VERSION);
	}
	return out;
}

/** Compute the inbound strip set: RFC 7230 hop-by-hop ∪ Connection ∪ reserved. */
function inboundStripSet(input: Headers): ReadonlySet<string> {
	const hopByHop = effectiveHopByHopHeaders(input);
	return new Set([...hopByHop, ...INBOUND_RESERVED_HEADERS]);
}

/** Compute the outbound strip set: RFC 7230 hop-by-hop ∪ Connection ∪ reserved. */
function outboundStripSet(input: Headers): ReadonlySet<string> {
	const hopByHop = effectiveHopByHopHeaders(input);
	return new Set([...hopByHop, ...OUTBOUND_RESERVED_HEADERS]);
}

/**
 * Forward an inbound `/v1/...` request to `https://api.anthropic.com/v1/...`,
 * mutating the system prompt for `/v1/messages` and rewriting authentication
 * per the configured upstream strategy. The upstream response body is
 * streamed back unchanged.
 *
 * Behaviour:
 *
 * - GET/HEAD requests pass through with only auth + version header rewriting.
 * - Non-messages endpoints (e.g. `/v1/messages/count_tokens`) parse their
 *   body for validity but receive no system-prompt injection.
 * - Non-2xx upstream responses are forwarded verbatim so the calling SDK can
 *   apply its own 429/5xx detection.
 * - Invalid JSON in the inbound body returns `400 invalid_json` without
 *   contacting the upstream.
 */
export async function forward(args: {
	readonly request: Request;
	readonly pathname: string;
	readonly search: string;
	readonly auth: UpstreamAuth;
	readonly fetchImpl?: typeof fetch;
	readonly onDebug?: (info: {
		readonly upstreamUrl: string;
		readonly mutatedBody: unknown;
		readonly upstreamStatus: number;
	}) => void;
}): Promise<Response> {
	const pathParts = extractV1PathSegments(args.pathname);

	const method = args.request.method.toUpperCase();
	const hasBody = method !== "GET" && method !== "HEAD";

	const prepared = hasBody
		? prepareBody(await args.request.text(), pathParts, args.auth)
		: { mutatedBody: undefined, serialised: "" };

	if (prepared === null) {
		return new Response(
			JSON.stringify({ error: "invalid_json", message: "Request body is not valid JSON" }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	}

	const filtered = filterHeaders(args.request.headers, inboundStripSet(args.request.headers));
	const upstreamHeaders = applyAuth(filtered, args.auth);
	if (hasBody) {
		upstreamHeaders.set("content-type", "application/json");
	}

	const upstreamUrl = buildUpstreamUrl(pathParts, args.search.replace(/^\?/, ""));

	return proxy({
		upstreamUrl,
		method,
		requestHeaders: upstreamHeaders,
		body: prepared.serialised || undefined,
		filterResponseHeaders: (h) => filterHeaders(h, outboundStripSet(h)),
		fetchImpl: args.fetchImpl,
		onDebug: args.onDebug
			? (url, status) => {
					args.onDebug?.({
						upstreamUrl: url,
						mutatedBody: prepared.mutatedBody,
						upstreamStatus: status,
					});
				}
			: undefined,
	});
}
