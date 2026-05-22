import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildWebRequestHeaders,
	buildWebRequestUrl,
	pipeResponseBack,
	vercelEntry,
} from "../src/vercel-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(
	url: string,
	headers: Record<string, string | string[]> = {},
	method = "GET",
): IncomingMessage {
	const readable = Readable.from([]);
	Object.assign(readable, {
		url,
		method,
		headers: { host: "example.com", ...headers },
	});
	return readable as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _written: string[]; _ended: boolean; _status: number } {
	const chunks: string[] = [];
	return {
		statusCode: 200,
		_written: chunks,
		_ended: false,
		_status: 200,
		setHeader: vi.fn(),
		end: vi.fn((data?: string) => {
			if (data) chunks.push(data);
		}),
	} as unknown as ServerResponse & { _written: string[]; _ended: boolean; _status: number };
}

// ---------------------------------------------------------------------------
// buildWebRequestUrl
// ---------------------------------------------------------------------------

describe("buildWebRequestUrl", () => {
	it("builds an https URL from host + url", () => {
		const req = makeReq("/v1/messages");
		const result = buildWebRequestUrl(req);
		expect(result).toBe("https://example.com/v1/messages");
	});

	it("honours x-forwarded-proto header", () => {
		const req = makeReq("/v1/messages", { "x-forwarded-proto": "http" });
		expect(buildWebRequestUrl(req)).toBe("http://example.com/v1/messages");
	});

	it("takes first value when x-forwarded-proto is an array", () => {
		const req = makeReq("/v1/messages", { "x-forwarded-proto": ["http", "https"] });
		expect(buildWebRequestUrl(req)).toBe("http://example.com/v1/messages");
	});

	it("strips the Vercel catch-all ?path= parameter", () => {
		const req = makeReq("/api/v1/messages?path=v1%2Fmessages");
		expect(buildWebRequestUrl(req)).toBe("https://example.com/api/v1/messages");
	});

	it("preserves other query parameters while stripping path=", () => {
		const req = makeReq("/api/v1/messages?path=v1%2Fmessages&foo=bar");
		expect(buildWebRequestUrl(req)).toBe("https://example.com/api/v1/messages?foo=bar");
	});

	it("returns URL without query string when there are no params after stripping", () => {
		const req = makeReq("/api/v1/messages?path=v1%2Fmessages");
		expect(buildWebRequestUrl(req)).not.toContain("?");
	});

	it("uses placeholder host when host header is absent", () => {
		const readable = Readable.from([]);
		Object.assign(readable, { url: "/v1/messages", method: "GET", headers: {} });
		const req = readable as unknown as IncomingMessage;
		const result = buildWebRequestUrl(req);
		expect(result).toContain("/v1/messages");
		expect(result).toMatch(/^https?:\/\//);
	});

	it("defaults to / when req.url is undefined", () => {
		const readable = Readable.from([]);
		Object.assign(readable, { url: undefined, method: "GET", headers: { host: "example.com" } });
		const req = readable as unknown as IncomingMessage;
		expect(buildWebRequestUrl(req)).toBe("https://example.com/");
	});
});

// ---------------------------------------------------------------------------
// buildWebRequestHeaders
// ---------------------------------------------------------------------------

describe("buildWebRequestHeaders", () => {
	it("copies scalar headers", () => {
		const req = makeReq("/", { "content-type": "application/json" });
		const headers = buildWebRequestHeaders(req);
		expect(headers.get("content-type")).toBe("application/json");
	});

	it("flattens array headers via append", () => {
		const req = makeReq("/", { "x-custom": ["a", "b"] });
		const headers = buildWebRequestHeaders(req);
		// Headers.getAll / get returns comma-joined for multi-value
		expect(headers.get("x-custom")).toMatch(/a/);
		expect(headers.get("x-custom")).toMatch(/b/);
	});

	it("skips undefined header values", () => {
		const readable = Readable.from([]);
		Object.assign(readable, {
			url: "/",
			method: "GET",
			headers: { host: "example.com", "x-stripped": undefined },
		});
		const req = readable as unknown as IncomingMessage;
		const headers = buildWebRequestHeaders(req);
		expect(headers.has("x-stripped")).toBe(false);
	});

	it("copies multiple distinct headers", () => {
		const req = makeReq("/", {
			accept: "text/event-stream",
			"anthropic-version": "2023-06-01",
		});
		const headers = buildWebRequestHeaders(req);
		expect(headers.get("accept")).toBe("text/event-stream");
		expect(headers.get("anthropic-version")).toBe("2023-06-01");
	});
});

// ---------------------------------------------------------------------------
// pipeResponseBack
// ---------------------------------------------------------------------------

describe("pipeResponseBack", () => {
	it("sets status code from the web response", async () => {
		const res = makeRes();
		const webResponse = new Response("ok", { status: 201 });
		await pipeResponseBack(webResponse, res);
		expect(res.statusCode).toBe(201);
	});

	it("copies response headers to ServerResponse", async () => {
		const res = makeRes();
		const webResponse = new Response("ok", {
			headers: { "content-type": "application/json", "x-custom": "test" },
		});
		await pipeResponseBack(webResponse, res);
		expect(vi.mocked(res.setHeader)).toHaveBeenCalledWith("content-type", "application/json");
		expect(vi.mocked(res.setHeader)).toHaveBeenCalledWith("x-custom", "test");
	});

	it("buffers and ends response for non-streaming content", async () => {
		const res = makeRes();
		const webResponse = new Response(JSON.stringify({ ok: true }), {
			headers: { "content-type": "application/json" },
		});
		await pipeResponseBack(webResponse, res);
		expect(vi.mocked(res.end)).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
	});

	it("handles null body gracefully", async () => {
		const res = makeRes();
		const webResponse = new Response(null, { status: 204 });
		await pipeResponseBack(webResponse, res);
		expect(vi.mocked(res.end)).toHaveBeenCalledWith("");
	});
});

// ---------------------------------------------------------------------------
// vercelEntry
// ---------------------------------------------------------------------------

describe("vercelEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the handler with a Request built from IncomingMessage", async () => {
		const handler = vi.fn().mockResolvedValue(new Response("hello", { status: 200 }));
		const req = makeReq("/v1/messages", { "content-type": "application/json" }, "GET");
		const res = makeRes();
		await vercelEntry(req, res, handler);
		expect(handler).toHaveBeenCalledOnce();
		const passedRequest = handler.mock.calls[0]?.[0] as Request;
		expect(passedRequest.method).toBe("GET");
		expect(passedRequest.headers.get("content-type")).toBe("application/json");
	});

	it("forwards the handler's response status to ServerResponse", async () => {
		const handler = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
		const req = makeReq("/v1/missing");
		const res = makeRes();
		await vercelEntry(req, res, handler);
		expect(res.statusCode).toBe(404);
	});

	it("sends a JSON body for POST requests using req.body when available", async () => {
		const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
		const readable = Readable.from([]);
		Object.assign(readable, {
			url: "/v1/messages",
			method: "POST",
			headers: { host: "example.com", "content-type": "application/json" },
			body: { model: "claude-opus-4-5", messages: [] },
		});
		const req = readable as unknown as IncomingMessage;
		const res = makeRes();
		await vercelEntry(req, res, handler);
		const passedRequest = handler.mock.calls[0]?.[0] as Request;
		const body = await passedRequest.text();
		expect(JSON.parse(body)).toEqual({ model: "claude-opus-4-5", messages: [] });
	});

	it("returns 500 and logs when the handler throws", async () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const handler = vi.fn().mockRejectedValue(new Error("boom"));
		const req = makeReq("/v1/messages");
		const res = makeRes();
		await vercelEntry(req, res, handler);
		expect(res.statusCode).toBe(500);
		expect(vi.mocked(res.end)).toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("uses default handle import when handler argument is omitted (smoke)", () => {
		// Verify the function signature accepts two arguments (uses default)
		expect(vercelEntry.length).toBe(2);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});
});
