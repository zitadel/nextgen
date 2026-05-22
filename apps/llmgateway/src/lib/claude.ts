import { jsonResponse } from "../utils/response.js";
import { filterHeaders, proxy } from "./proxy.js";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION_PREFIX = "v1";
const ANTHROPIC_BETA_QUERY_PARAM = "beta";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/**
 * Upstream credential strategy passed to {@link callClaude}.
 *
 * - `oauth`: bearer token issued by claude.ai. Triggers `anthropic-beta:
 *   oauth-2025-04-20` injection.
 * - `apiKey`: a `sk-ant-…` key from `console.anthropic.com`. Sets `x-api-key`.
 */
export type ClaudeAuth =
	| { readonly mode: "oauth"; readonly token: string }
	| { readonly mode: "apiKey"; readonly key: string };

/**
 * Compose the absolute Anthropic upstream URL from path segments and a query
 * string. Strips the `beta` query parameter before appending the remaining
 * query string.
 */
function buildUpstreamUrl(pathSegments: ReadonlyArray<string>, search: string): string {
	const upstream = new URL(
		`${ANTHROPIC_API_ORIGIN}/${ANTHROPIC_API_VERSION_PREFIX}/${pathSegments.join("/")}`,
	);
	const params = new URLSearchParams(search);
	params.delete(ANTHROPIC_BETA_QUERY_PARAM);
	upstream.search = params.toString();
	return upstream.toString();
}

/**
 * Return a new `Headers` with the appropriate upstream auth applied. Does NOT
 * mutate the input.
 *
 * - `oauth` mode: sets `Authorization: Bearer <token>` and ensures
 *   `anthropic-beta: oauth-2025-04-20` is present (appended when a beta header
 *   already exists; not duplicated when already listed).
 * - `apiKey` mode: sets `x-api-key: <key>`.
 *
 * Always ensures `anthropic-version` is set, defaulting to `"2023-06-01"` when
 * the header is absent from `input`.
 */
function applyAuth(input: Headers, auth: ClaudeAuth): Headers {
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

/**
 * Options for a single Claude API call issued by {@link callClaude}.
 */
export interface ClaudeOptions {
	/** Credential strategy to use for the upstream request. */
	readonly auth: ClaudeAuth;
	/** Path segments after `/v1/`, e.g. `["messages"]`. */
	readonly pathSegments: ReadonlyArray<string>;
	/** Query string WITHOUT a leading `?`; the `beta` param is always stripped. */
	readonly search: string;
	/** HTTP method to use for the upstream request. */
	readonly method: string;
	/**
	 * Raw inbound headers. Business-specific headers (e.g. `authorization`,
	 * `host`) are stripped via {@link stripRequestHeaders} before gateway auth
	 * is applied. RFC 7230 hop-by-hop headers are stripped automatically by
	 * the underlying proxy.
	 */
	readonly requestHeaders: Headers;
	/**
	 * Request headers to remove before gateway auth is applied. Use this for
	 * headers whose inbound values must not reach the upstream — for example,
	 * a client-supplied `Authorization` that the gateway replaces with its own
	 * credential. Stripped before {@link auth} is written, so gateway auth
	 * headers are never themselves removed.
	 */
	readonly stripRequestHeaders?: ReadonlySet<string>;
	/** Pre-serialised request body. Omit for GET/HEAD requests. */
	readonly body?: string;
	/**
	 * Called with the raw body string before forwarding. Return the (possibly
	 * mutated) body to use, or `null` to abort with a `400 invalid_json`
	 * response. NOT called when `body` is `undefined`.
	 */
	readonly onBody?: (body: string) => string | null;
	/**
	 * Additional response headers to strip beyond the RFC 7230 hop-by-hop set,
	 * which is always removed automatically by the underlying proxy.
	 */
	readonly stripResponseHeaders?: ReadonlySet<string>;
	/** Replaceable fetch implementation — useful for injecting test doubles. */
	readonly fetchImpl?: typeof fetch;
	/**
	 * Optional debug callback fired after the upstream response arrives.
	 * Receives the upstream URL and HTTP status code.
	 */
	readonly onDebug?: (upstreamUrl: string, upstreamStatus: number) => void;
}

/**
 * Generic Claude API client. Builds the upstream URL, strips caller-specified
 * request headers, applies auth, optionally transforms the body via `onBody`,
 * and delegates the actual HTTP call to {@link proxy}.
 *
 * @param options - Call options; see {@link ClaudeOptions}.
 * @returns A {@link Response} from the upstream, or a `400` response when
 *   `onBody` returns `null`.
 */
export async function callClaude(options: ClaudeOptions): Promise<Response> {
	const upstreamUrl = buildUpstreamUrl(options.pathSegments, options.search);

	// Strip business-specific request headers first, then apply gateway auth
	// so that the gateway's own auth headers are never inadvertently removed.
	const strippedHeaders = options.stripRequestHeaders
		? filterHeaders(options.requestHeaders, options.stripRequestHeaders)
		: options.requestHeaders;
	const upstreamHeaders = applyAuth(strippedHeaders, options.auth);

	let finalBody: string | undefined;

	if (options.body !== undefined) {
		const transformed = options.onBody ? options.onBody(options.body) : options.body;
		if (transformed === null) {
			return jsonResponse({ error: "invalid_json", message: "Request body is not valid JSON" }, 400);
		}
		finalBody = transformed;
		upstreamHeaders.set("content-type", "application/json");
	}

	return proxy({
		upstreamUrl,
		method: options.method,
		requestHeaders: upstreamHeaders,
		body: finalBody,
		stripResponseHeaders: options.stripResponseHeaders,
		fetchImpl: options.fetchImpl,
		onDebug: options.onDebug,
	});
}
