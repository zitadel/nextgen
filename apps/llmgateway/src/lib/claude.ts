import { jsonResponse } from "../utils/response.js";
import { proxy } from "./proxy.js";

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
 * Build the outgoing request headers: strip client-supplied `authorization`,
 * apply gateway credentials, set `anthropic-version` if absent, and
 * conditionally add `content-type: application/json` for requests with a body.
 *
 * Accepting `hasJsonBody` here keeps header construction as a single,
 * mutation-free step in {@link callClaude}.
 */
function buildRequestHeaders(input: Headers, auth: ClaudeAuth, hasJsonBody: boolean): Headers {
	const out = new Headers(input);

	// Remove any client-supplied Authorization before writing gateway auth so
	// it does not leak to the upstream (especially in API-key mode, where
	// applyAuth does not overwrite the header).
	out.delete("authorization");

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

	if (hasJsonBody) {
		out.set("content-type", "application/json");
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
	/** Raw inbound headers; gateway auth is applied by {@link callClaude}. */
	readonly requestHeaders: Headers;
	/** Pre-serialised request body. Omit for GET/HEAD requests. */
	readonly body?: string;
	/**
	 * Called with the raw body string before forwarding. Return the (possibly
	 * mutated) body to use, or `null` to abort with a `400 invalid_json`
	 * response. NOT called when `body` is `undefined`.
	 */
	readonly onBody?: (body: string) => string | null;
	/** Replaceable fetch implementation — useful for injecting test doubles. */
	readonly fetchImpl?: typeof fetch;
	/**
	 * Optional debug callback fired after the upstream response arrives.
	 * Receives the upstream URL and HTTP status code.
	 */
	readonly onDebug?: (upstreamUrl: string, upstreamStatus: number) => void;
}

/**
 * Generic Claude API client. Builds the upstream URL, applies gateway auth,
 * optionally transforms the request body via `onBody`, and delegates the
 * actual HTTP call to {@link proxy}.
 *
 * @param options - Call options; see {@link ClaudeOptions}.
 * @returns A {@link Response} from the upstream, or a `400` response when
 *   `onBody` returns `null`.
 */
export async function callClaude(options: ClaudeOptions): Promise<Response> {
	const url = new URL(
		`${ANTHROPIC_API_ORIGIN}/${ANTHROPIC_API_VERSION_PREFIX}/${options.pathSegments.join("/")}`,
	);
	const searchParams = new URLSearchParams(options.search);
	searchParams.delete(ANTHROPIC_BETA_QUERY_PARAM);
	url.search = searchParams.toString();

	const body =
		options.body === undefined
			? undefined
			: options.onBody
				? options.onBody(options.body)
				: options.body;

	if (body === null) {
		return jsonResponse({ error: "invalid_json", message: "Request body is not valid JSON" }, 400);
	}

	return proxy({
		upstreamUrl: url.toString(),
		method: options.method,
		requestHeaders: buildRequestHeaders(options.requestHeaders, options.auth, body !== undefined),
		body,
		fetchImpl: options.fetchImpl,
		onDebug: options.onDebug,
	});
}
