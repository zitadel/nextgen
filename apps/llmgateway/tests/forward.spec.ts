import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it } from "vitest";

import { type ClaudeAuth } from "../src/forward.js";
import { extractV1PathSegments, forward, prepareBody } from "../src/forward.js";
import { CLAUDE_CODE_IDENTIFIER_TEXT } from "../src/inject.js";
import { buildFetchMock } from "./helpers/fetch-mock.js";

const OAUTH_AUTH: ClaudeAuth = { mode: "oauth", token: "oauth-token" };
const OAUTH_AUTH_WITH_REFRESH: ClaudeAuth = {
	mode: "oauth",
	token: "expired-access-token",
	refreshToken: "my-refresh-token",
};
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
		expect(out).not.toBeNull();
		const system = (out!.mutatedBody as { system: ReadonlyArray<TextBlockParam> }).system;
		expect(system).toHaveLength(2);
		expect(system[0]?.text).not.toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(system[1]?.text).toBe("X");
	});

	it("injects guardrail + identifier (OAuth mode) for /v1/messages", () => {
		const raw = JSON.stringify({ messages: [] });
		const out = prepareBody(raw, ["messages"], OAUTH_AUTH);
		expect(out).not.toBeNull();
		const system = (out!.mutatedBody as { system: ReadonlyArray<TextBlockParam> }).system;
		expect(system[0]?.text).toBe(CLAUDE_CODE_IDENTIFIER_TEXT);
		expect(system).toHaveLength(2);
	});

	it("does NOT inject for non-messages endpoints (e.g. count_tokens)", () => {
		const raw = JSON.stringify({ model: "claude-sonnet-4-5", messages: [] });
		const out = prepareBody(raw, ["messages", "count_tokens"], OAUTH_AUTH);
		expect(out).not.toBeNull();
		expect((out!.mutatedBody as Record<string, unknown>)["system"]).toBeUndefined();
		expect(out.serialised).toBe(raw);
	});

	it("returns raw bytes unchanged when parsed body is not a plain object", () => {
		const arrRaw = JSON.stringify([1, 2, 3]);
		const arrOut = prepareBody(arrRaw, ["messages"], OAUTH_AUTH);
		expect(arrOut).not.toBeNull();
		expect(arrOut!.mutatedBody).toEqual([1, 2, 3]);
		expect(arrOut!.serialised).toBe(arrRaw);

		const nullRaw = "null";
		const nullOut = prepareBody(nullRaw, ["messages"], OAUTH_AUTH);
		expect(nullOut).not.toBeNull();
		expect(nullOut!.mutatedBody).toBeNull();
		expect(nullOut!.serialised).toBe(nullRaw);
	});

	it("returns null on malformed JSON", () => {
		expect(prepareBody("not-json", ["messages"], OAUTH_AUTH)).toBeNull();
	});
});

describe("forward — endpoint allowlist", () => {
	it("returns 404 for an unknown /v1/ path", async () => {
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/models", { method: "GET" });

		const res = await forward({
			request,
			pathname: "/v1/models",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toBe("not_found");
		expect(calls).toHaveLength(0);
	});

	it("allows /v1/messages", async () => {
		const { fetchImpl } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(200);
	});

	it("allows /v1/messages/count_tokens", async () => {
		const { fetchImpl } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages/count_tokens", {
			method: "POST",
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages/count_tokens",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(200);
	});
});

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

	it("strips a client-supplied x-api-key header in OAuth mode so it cannot shadow the Bearer token", async () => {
		// The Anthropic SDK always sends x-api-key regardless of auth mode.
		// Anthropic prioritises x-api-key over Bearer when both are present, so
		// a leaked placeholder key would cause "invalid x-api-key" 401s instead
		// of triggering the refresh flow.
		const { fetchImpl, calls } = buildFetchMock();
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "placeholder-must-not-reach-anthropic",
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

		const sentHeaders = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sentHeaders.has("x-api-key")).toBe(false);
		expect(sentHeaders.get("authorization")).toBe("Bearer oauth-token");
	});

	it("strips host and content-length from the forwarded request", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: {
				host: "placeholder.local",
				"content-length": "999",
				"content-type": "application/json",
				"x-keep": "kept",
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
		expect(sent.has("host")).toBe(false);
		expect(sent.has("content-length")).toBe(false);
		expect(sent.get("x-keep")).toBe("kept");
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

describe("forward — OAuth token auto-refresh", () => {
	/**
	 * Build a fetchImpl that returns `firstResponse` on the first call (the
	 * Anthropic API call) and `tokenResponse` on the second call (the OAuth
	 * token endpoint), then `retryResponse` on the third call (the retry).
	 *
	 * We use URL matching so the order doesn't matter for the token endpoint.
	 */
	function buildRefreshScenario(options: {
		firstStatus: number;
		tokenStatus: number;
		tokenBody?: unknown;
		retryStatus: number;
		retryBody?: string;
	}): { fetchImpl: typeof fetch; calls: Array<{ url: string }> } {
		const calls: Array<{ url: string }> = [];
		const fetchImpl: typeof fetch = async (url, _init) => {
			const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
			calls.push({ url: urlStr });

			if (urlStr.includes("oauth/token")) {
				return new Response(
					options.tokenBody !== undefined ? JSON.stringify(options.tokenBody) : "",
					{ status: options.tokenStatus, headers: { "content-type": "application/json" } },
				);
			}
			// First Anthropic API call
			if (calls.filter((c) => !c.url.includes("oauth")).length === 1) {
				return new Response("{}", { status: options.firstStatus });
			}
			// Retry Anthropic API call
			return new Response(options.retryBody ?? "{}", { status: options.retryStatus });
		};
		return { fetchImpl, calls };
	}

	it("refreshes the token and retries when upstream returns 401 with a refreshToken", async () => {
		const { fetchImpl, calls } = buildRefreshScenario({
			firstStatus: 401,
			tokenStatus: 200,
			tokenBody: { access_token: "new-access", refresh_token: "new-refresh" },
			retryStatus: 200,
			retryBody: '{"id":"msg_1"}',
		});

		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH_WITH_REFRESH,
			fetchImpl,
		});

		expect(res.status).toBe(200);
		// 3 calls: first Anthropic (401), token endpoint, retry Anthropic (200)
		expect(calls).toHaveLength(3);
		expect(calls[1]?.url).toContain("oauth/token");
	});

	it("returns the 401 when the refresh endpoint itself fails", async () => {
		const { fetchImpl, calls } = buildRefreshScenario({
			firstStatus: 401,
			tokenStatus: 400,
			tokenBody: { error: "invalid_grant" },
			retryStatus: 200,
		});

		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH_WITH_REFRESH,
			fetchImpl,
		});

		// Refresh failed → original 401 forwarded
		expect(res.status).toBe(401);
		// Only 2 calls: first Anthropic + token endpoint (no retry)
		expect(calls).toHaveLength(2);
	});

	it("passes 401 through without retry when OAuth auth has no refreshToken", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 401, body: '{"type":"error"}' });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: OAUTH_AUTH, // no refreshToken
			fetchImpl,
		});

		expect(res.status).toBe(401);
		expect(calls).toHaveLength(1); // no retry, no token call
	});

	it("passes 401 through without retry in API-key mode", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 401, body: '{"type":"error"}' });
		const request = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const res = await forward({
			request,
			pathname: "/v1/messages",
			search: "",
			auth: API_KEY_AUTH,
			fetchImpl,
		});

		expect(res.status).toBe(401);
		expect(calls).toHaveLength(1);
	});

	it("does NOT retry on non-401 upstream errors (e.g. 429, 500)", async () => {
		for (const status of [429, 500, 503]) {
			const { fetchImpl, calls } = buildFetchMock({ status, body: '{"type":"error"}' });
			const request = new Request("http://placeholder.local/v1/messages", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ messages: [] }),
			});

			const res = await forward({
				request,
				pathname: "/v1/messages",
				search: "",
				auth: OAUTH_AUTH_WITH_REFRESH,
				fetchImpl,
			});

			expect(res.status).toBe(status);
			expect(calls).toHaveLength(1); // no retry
		}
	});
});
