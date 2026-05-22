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
 * Compute the effective hop-by-hop header set for a message.
 *
 * Per RFC 7230 §6.1:
 *
 * > Connection options are case-insensitive. […] When a header field
 * > aside from `Connection` is used to supply control information for or
 * > about the current connection, the sender MUST list the corresponding
 * > field-name within the `Connection` header field. A proxy or gateway
 * > MUST parse a received `Connection` header field before a message is
 * > forwarded and […] remove the corresponding field(s).
 *
 * So the effective strip set is the union of:
 *
 * - The static RFC list in {@link RFC_7230_HOP_BY_HOP}.
 * - Every header name listed in the inbound `Connection` header.
 *
 * Bare connection-options (`close`, `keep-alive`) that appear in the
 * `Connection` value but don't name a real header pass through harmlessly —
 * the resulting set lookup just won't match anything.
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
 * Options for a single reverse-proxy request issued by {@link proxy}.
 */
export interface ProxyOptions {
	/** Absolute URL of the upstream endpoint to call. */
	readonly upstreamUrl: string;
	/** HTTP method to use for the upstream request. */
	readonly method: string;
	/** Headers to send to the upstream (already filtered/rewritten by the caller). */
	readonly requestHeaders: Headers;
	/** Serialised request body. Omit entirely for GET/HEAD requests. */
	readonly body?: string;
	/**
	 * Optional hook applied to the upstream response headers before they are
	 * included in the returned {@link Response}. Use this to strip hop-by-hop
	 * or other unwanted outbound headers.
	 */
	readonly filterResponseHeaders?: (headers: Headers) => Headers;
	/** Replaceable fetch implementation — useful for injecting test doubles. */
	readonly fetchImpl?: typeof fetch;
	/**
	 * Optional debug callback fired after the upstream response arrives.
	 * Receives the upstream URL and HTTP status code.
	 */
	readonly onDebug?: (upstreamUrl: string, upstreamStatus: number) => void;
}

/**
 * Generic HTTP reverse-proxy kernel.
 *
 * Sends `options.requestHeaders` and an optional `options.body` to
 * `options.upstreamUrl` using `options.method`, then returns a {@link Response}
 * whose body is streamed directly from the upstream. Response headers are
 * optionally transformed by `options.filterResponseHeaders` before being
 * forwarded to the caller.
 */
export async function proxy(options: ProxyOptions): Promise<Response> {
	const fetchImpl = options.fetchImpl ?? fetch;

	const init: RequestInit = { method: options.method, headers: options.requestHeaders };
	if (options.body !== undefined) {
		init.body = options.body;
	}

	const upstream = await fetchImpl(options.upstreamUrl, init);

	options.onDebug?.(options.upstreamUrl, upstream.status);

	const headers =
		options.filterResponseHeaders !== undefined
			? options.filterResponseHeaders(upstream.headers)
			: upstream.headers;

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}
