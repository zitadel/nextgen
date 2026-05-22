import { strict as assert } from "node:assert";

import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";

import { type ClaudeAuth } from "../src/forward.js";
import { extractV1PathSegments, forward, prepareBody } from "../src/forward.js";
import { CLAUDE_CODE_IDENTIFIER_TEXT } from "../src/inject.js";

const OAUTH_AUTH: ClaudeAuth = { mode: "oauth", token: "oauth-token" };
const API_KEY_AUTH: ClaudeAuth = { mode: "apiKey", key: "sk-ant-test" };

describe("extractV1PathSegments", () => {
	it("strips /v1/ for direct hits", () => {
		expect(extractV1PathSegments("/v1/messages")).toEqual(["messages"]);
	});

	it("strips /api/v1/ for the catch-all route", () => {
		expect(extractV1PathSegments("/api/v1/messages")).toEqual(["messages"]);
	});

	it("preserves multiple segments after /v1/", () => {
		expect(extractV1PathSegments("/v1/messages/count_tokens")).toEqual([
			"messages",
			"count_tokens",
		]);
	});

	it("strips multiple leading slashes", () => {
		expect(extractV1PathSegments("///v1/messages")).toEqual(["messages"]);
	});

	it("ignores empty path segments from doubled slashes", () => {
		expect(extractV1PathSegments("/v1//messages//count_tokens")).toEqual([
			"messages",
			"count_tokens",
		]);
	});

	it("returns the segments verbatim when the path doesn't match either pattern", () => {
		expect(extractV1PathSegments("/health")).toEqual(["health"]);
		expect(extractV1PathSegments("/")).toEqual([]);
	});
});

describe("prepareBody", () => {
	it("returns empty result for an empty raw body", () => {
		const out = prepareBody("", ["messages"], API_KEY_AUTH);
		expect(out).toEqual({ mutatedBody: undefined, serialised: "" });
	});

	it("injects guardrail (API-key mode) for /v1/messages", () => {
		const raw = JSON.stringify({ model: "claude-sonnet-4-5", messages: [], system: "X" });
		const out = prepareBody(raw, ["messages"], API_KEY_AUTH);
		assert(out !== null);
		const system = (out.mutatedBody as { system: ReadonlyArray<TextBlockParam> }).system;
		expect(system).toHaveLength(2);
		expect(system[0]?.text).not.toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(system[1]?.text).toBe("X");
	});

	it("injects guardrail + identifier (OAuth mode) for /v1/messages", () => {
		const raw = JSON.stringify({ messages: [] });
		const out = prepareBody(raw, ["messages"], OAUTH_AUTH);
		assert(out !== null);
		const system = (out.mutatedBody as { system: ReadonlyArray<TextBlockParam> }).system;
		expect(system[0]?.text).toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(system).toHaveLength(2);
	});

	it("does NOT inject for non-messages endpoints (e.g. count_tokens)", () => {
		const raw = JSON.stringify({ model: "claude-sonnet-4-5", messages: [] });
		const out = prepareBody(raw, ["messages", "count_tokens"], OAUTH_AUTH);
		assert(out !== null);
		expect((out.mutatedBody as Record<string, unknown>)["system"]).toBeUndefined();
		expect(out.serialised).toBe(raw);
	});

	it("returns raw bytes unchanged when parsed body is not a plain object", () => {
		const arrRaw = JSON.stringify([1, 2, 3]);
		const arrOut = prepareBody(arrRaw, ["messages"], OAUTH_AUTH);
		assert(arrOut !== null);
		expect(arrOut.mutatedBody).toEqual([1, 2, 3]);
		expect(arrOut.serialised).toBe(arrRaw);

		const nullRaw = "null";
		const nullOut = prepareBody(nullRaw, ["messages"], OAUTH_AUTH);
		assert(nullOut !== null);
		expect(nullOut.mutatedBody).toBeNull();
		expect(nullOut.serialised).toBe(nullRaw);
	});

	it("returns null on malformed JSON", () => {
		expect(prepareBody("not-json", ["messages"], OAUTH_AUTH)).toBeNull();
	});
});

function buildFetchMock(
	responseInit: { status: number; body?: string; headers?: Record<string, string> } = {
		status: 200,
	},
): {
	fetchImpl: typeof fetch;
	calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
	const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
	const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return new Response(responseInit.body ?? "", {
			status: responseInit.status,
			headers: responseInit.headers ?? { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

describe("forward", () => {
	it("returns 400 for invalid JSON without calling upstream", async () => {
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "not-json",
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
		expect(calls).toHaveLength(0);
	});

	it("forwards GET requests with no body and only header rewriting", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 405, body: "method-not-allowed" });
		const request = new Request("http://placeholder.local/v1/messages", { method: "GET" });

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(405);
		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
		expect(((calls[0] as { init: RequestInit }).init.headers as Headers).get("x-api-key")).toBe(
			"sk-ant-test",
		);
		expect((calls[0] as { init: RequestInit }).init.body).toBeUndefined();
	});

	it("injects guardrail + identifier for OAuth-mode POST /v1/messages", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "claude-sonnet-4-5",
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH,
			fetchImpl,
		});

		const sentBody = JSON.parse((calls[0] as { init: RequestInit }).init.body as string) as {
			system: ReadonlyArray<TextBlockParam>;
		};
		expect(sentBody.system[0]?.text).toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(sentBody.system).toHaveLength(2);

		const sentHeaders = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sentHeaders.get("authorization")).toBe("Bearer oauth-token");
		expect(sentHeaders.get("anthropic-beta")).toBe("oauth-2025-04-20");
		expect(sentHeaders.has("x-api-key")).toBe(false);
	});

	it("uses x-api-key and no Claude Code identifier in API-key mode", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		const sentBody = JSON.parse((calls[0] as { init: RequestInit }).init.body as string) as {
			system: ReadonlyArray<TextBlockParam>;
		};
		expect(sentBody.system[0]?.text).not.toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(sentBody.system).toHaveLength(1);

		const sentHeaders = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sentHeaders.get("x-api-key")).toBe("sk-ant-test");
		expect(sentHeaders.has("authorization")).toBe(false);
	});

	it("strips the inbound authorization header before forwarding", async () => {
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer client-supplied-must-not-leak",
			},
			body: JSON.stringify({ messages: [] }),
		});

		await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH,
			fetchImpl,
		});

		expect(((calls[0] as { init: RequestInit }).init.headers as Headers).get("authorization")).toBe(
			"Bearer oauth-token",
		);
	});

	it("strips outbound content-encoding and content-length", async () => {
		const { fetchImpl } = buildFetchMock({
			status: 200,
			body: "{}",
			headers: {
				"content-type": "application/json",
				"content-encoding": "gzip",
				"content-length": "1024",
			},
		});
		const request = new Request("http://placeholder.local/v1/messages", { method: "GET" });

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.headers.has("content-encoding")).toBe(false);
		expect(res.headers.has("content-length")).toBe(false);
		expect(res.headers.get("content-type")).toBe("application/json");
	});

	it("emits onDebug after a successful forward", async () => {
		const { fetchImpl } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const debugCalls: Array<{ upstreamUrl: string; upstreamStatus: number }> = [];
		await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
			onDebug: ({ upstreamUrl, upstreamStatus }) => {
				debugCalls.push({ upstreamUrl, upstreamStatus });
			},
		});

		expect(debugCalls).toEqual([
			{ upstreamUrl: "https://api.anthropic.com/v1/messages", upstreamStatus: 200 },
		]);
	});

	it("forwards a 4xx response body verbatim (no rewrapping)", async () => {
		const errorBody = JSON.stringify({
			type: "error",
			error: { type: "rate_limit_error", message: "Error" },
		});
		const { fetchImpl } = buildFetchMock({ status: 429, body: errorBody });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(429);
		expect(await res.text()).toBe(errorBody);
	});

	it("strips the beta query param when building the upstream URL", async () => {
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/messages?beta=foo&stream=true", {
			method: "GET",
		});

		await forward({
			request,
			pathname: "/v1/messages",
			search: "beta=foo&stream=true",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages?stream=true");
	});

	it("expands RFC 7230 §6.1 hop-by-hop headers listed in Connection", async () => {
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				connection: "x-trace-id, close",
				"x-trace-id": "should-be-stripped",
				"x-keep-me": "kept",
			},
			body: JSON.stringify({ messages: [] }),
		});

		await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		const sent = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sent.has("x-trace-id")).toBe(false);
		expect(sent.has("connection")).toBe(false);
		expect(sent.get("x-keep-me")).toBe("kept");
	});
});
