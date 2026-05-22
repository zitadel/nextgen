import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import handle from "./handler.js";

const VERCEL_CATCHALL_PARAM = "path";
const PLACEHOLDER_HOST = "placeholder.local";
const DEFAULT_PROTOCOL = "https";

/**
 * Build the absolute URL for the Web `Request`. Honours `x-forwarded-proto`
 * for protocol resolution, defaults to `https`. Strips Vercel's catch-all
 * `path` query parameter — an internal routing artefact from `[...path].ts`
 * — so handler-side code never sees it.
 */
export function buildWebRequestUrl(req: IncomingMessage): string {
	const host = (req.headers["host"] as string | undefined) ?? PLACEHOLDER_HOST;
	const protoHeader = req.headers["x-forwarded-proto"];
	const protocol = Array.isArray(protoHeader)
		? (protoHeader[0] ?? DEFAULT_PROTOCOL)
		: (protoHeader ?? DEFAULT_PROTOCOL);

	const rawUrl = req.url ?? "/";
	const [pathname, search] = rawUrl.split("?", 2);
	if (search === undefined) {
		return `${protocol}://${host}${pathname}`;
	}
	const params = new URLSearchParams(search);
	params.delete(VERCEL_CATCHALL_PARAM);
	const cleaned = params.toString();
	return cleaned.length > 0
		? `${protocol}://${host}${pathname}?${cleaned}`
		: `${protocol}://${host}${pathname}`;
}

/**
 * Copy `IncomingMessage` headers into a fresh Web `Headers` object.
 * Multi-value headers are flattened via `Headers.append`; undefined values
 * are skipped (Node surfaces them for headers Vercel has already stripped).
 */
export function buildWebRequestHeaders(req: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const v of value) {
				headers.append(key, v);
			}
			continue;
		}
		headers.set(key, value);
	}
	return headers;
}

/**
 * Pipe a `Response` back through a Node `ServerResponse`.
 *
 * `text/event-stream` bodies are piped so SSE framing survives end-to-end.
 * Everything else is buffered and written in one shot — more reliable in
 * Vercel's Node runtime for short JSON payloads than per-chunk piping.
 */
export async function pipeResponseBack(webResponse: Response, res: ServerResponse): Promise<void> {
	res.statusCode = webResponse.status;
	webResponse.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	const contentType = webResponse.headers.get("content-type") ?? "";
	const isStreaming = contentType.includes("text/event-stream");

	if (isStreaming && webResponse.body !== null) {
		const nodeStream = Readable.fromWeb(
			webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0],
		);
		nodeStream.pipe(res);
		return;
	}

	const bodyText = webResponse.body !== null ? await webResponse.text() : "";
	res.end(bodyText);
}

/**
 * Vercel Node-runtime adapter. Translates the legacy `(req, res)` signature
 * to the Web Standards `handle(Request): Promise<Response>` core.
 *
 * Vercel's Node.js runtime always calls serverless functions with the
 * `(IncomingMessage, ServerResponse)` signature — `export const config =
 * { runtime: "edge" }` is silently ignored for non-Next.js projects and
 * `Request/Response` handlers are not auto-detected. This adapter is the
 * required bridge.
 *
 * The optional `handler` parameter lets tests inject a stub; production
 * callers omit it to use {@link ./handler.ts}'s default export.
 */
export async function vercelEntry(
	req: IncomingMessage,
	res: ServerResponse,
	handler: (request: Request) => Promise<Response> = handle,
): Promise<void> {
	try {
		const method = (req.method ?? "GET").toUpperCase();
		const hasBody = method !== "GET" && method !== "HEAD";

		const init: RequestInit = {
			method,
			headers: buildWebRequestHeaders(req),
		};
		if (hasBody) {
			const { body } = req as IncomingMessage & { readonly body?: unknown };
			init.body = typeof body === "string" ? body : JSON.stringify(body);
		}

		const webRequest = new Request(buildWebRequestUrl(req), init);
		const webResponse = await handler(webRequest);
		await pipeResponseBack(webResponse, res);
	} catch (err) {
		process.stderr.write(
			`[vercel-entry] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
		);
		if (res.headersSent) {
			res.end();
			return;
		}
		res.statusCode = 500;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				error: "gateway_error",
				message: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}
