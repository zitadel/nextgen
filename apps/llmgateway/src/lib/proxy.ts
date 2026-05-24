import { jsonResponse } from "../utils/response.js";

/**
 * Hop-by-hop headers defined by RFC 7230 §6.1. These describe a single
 * transport connection and MUST NOT be forwarded by an intermediary.
 *
 * See https://www.rfc-editor.org/rfc/rfc7230#section-6.1.
 */
const RFC_7230_HOP_BY_HOP: ReadonlySet<string> = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

/**
 * Connection-options that may appear in a `Connection` header value but
 * are not themselves header names to strip. Defined by RFC 7230 §6.1.
 */
const CONNECTION_OPTION_TOKENS: ReadonlySet<string> = new Set(["close", "keep-alive"]);

/**
 * Request headers stripped unconditionally on every forwarded request.
 *
 * - `host`: always rewritten to the upstream origin by the HTTP client;
 *   forwarding the inbound value would send the wrong host to the upstream.
 * - `content-length`: may be wrong after any body transformation; the HTTP
 *   client recalculates it from the actual body string.
 */
const PROXY_STRIP_REQUEST: ReadonlySet<string> = new Set(["host", "content-length"]);

/**
 * Response headers stripped unconditionally before returning the upstream
 * response to the caller.
 *
 * - `content-encoding`: `fetch()` decompresses transparently but keeps the
 *   header, so the caller would attempt a second decompression pass.
 * - `content-length`: after decompression the byte count no longer matches;
 *   also wrong for chunked/streaming bodies.
 */
const PROXY_STRIP_RESPONSE: ReadonlySet<string> = new Set(["content-encoding", "content-length"]);

/**
 * Compute the effective hop-by-hop header set for a message.
 *
 * Per RFC 7230 §6.1 the effective strip set is the union of the static RFC
 * list and every header name listed in the inbound `Connection` header.
 */
export function effectiveHopByHopHeaders(input: Headers): ReadonlySet<string> {
	const connection = input.get("connection");
	if (connection === null) {
		return RFC_7230_HOP_BY_HOP;
	}
	const extras = connection
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0 && !CONNECTION_OPTION_TOKENS.has(s));
	if (extras.length === 0) {
		return RFC_7230_HOP_BY_HOP;
	}
	return new Set([...RFC_7230_HOP_BY_HOP, ...extras]);
}

/**
 * Return a new `Headers` object containing only those entries from `input`
 * whose lowercase name is **not** in `strip`. The input is not mutated.
 */
export function filterHeaders(input: Headers, strip: ReadonlySet<string>): Headers {
	const out = new Headers();
	input.forEach((value, key) => {
		if (!strip.has(key.toLowerCase())) {
			out.append(key, value);
		}
	});
	return out;
}

/**
 * Generic HTTP reverse-proxy service.
 *
 * Automatically strips hop-by-hop headers, `host`, and `content-length` on
 * every forwarded request, and `content-encoding` / `content-length` on
 * every upstream response.
 *
 * When `allowedUrls` is provided, the upstream URL's pathname must match at
 * least one entry before the request is forwarded. A string entry is an exact
 * pathname match; a RegExp entry is tested against the pathname. Non-matching
 * requests return `404 not_found` without calling the upstream.
 */
export class ProxyService {
	readonly #allowedUrls: ReadonlyArray<string | RegExp>;
	readonly #fetchImpl: typeof fetch;

	constructor(options: {
		readonly allowedUrls?: ReadonlyArray<string | RegExp>;
		readonly fetchImpl?: typeof fetch;
	}) {
		this.#allowedUrls = options.allowedUrls ?? [];
		this.#fetchImpl = options.fetchImpl ?? fetch;
	}

	async call(
		upstreamUrl: string,
		method: string,
		requestHeaders: Headers,
		body?: string,
		onDebug?: (upstreamUrl: string, upstreamStatus: number) => void,
	): Promise<Response> {
		if (this.#allowedUrls.length > 0) {
			const { pathname } = new URL(upstreamUrl);
			const allowed = this.#allowedUrls.some((entry) =>
				typeof entry === "string" ? entry === pathname : entry.test(pathname),
			);
			if (!allowed) {
				return jsonResponse(
					{ error: "not_found", message: "Endpoint not supported" },
					404,
				);
			}
		}

		const reqStrip = new Set([...effectiveHopByHopHeaders(requestHeaders), ...PROXY_STRIP_REQUEST]);
		const filteredReq = filterHeaders(requestHeaders, reqStrip);

		const upstream = await this.#fetchImpl(upstreamUrl, {
			method,
			headers: filteredReq,
			...(body !== undefined && { body }),
		});

		onDebug?.(upstreamUrl, upstream.status);

		const resStrip = new Set([
			...effectiveHopByHopHeaders(upstream.headers),
			...PROXY_STRIP_RESPONSE,
		]);

		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: filterHeaders(upstream.headers, resStrip),
		});
	}
}
