import { describe, expect, it, vi } from "vitest";

import { callClaude, type ClaudeAuth } from "../../src/lib/claude.js";

const OAUTH_AUTH: ClaudeAuth = { mode: "oauth", token: "oauth-token" };
const API_KEY_AUTH: ClaudeAuth = { mode: "apiKey", key: "sk-ant-test" };

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

describe("callClaude — auth modes", () => {
	it("OAuth mode sets Authorization: Bearer header", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: "{}",
			fetchImpl,
		});

		const sentHeaders = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sentHeaders.get("authorization")).toBe("Bearer oauth-token");
		expect(sentHeaders.has("x-api-key")).toBe(false);
	});

	it("API key mode sets x-api-key header", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: "{}",
			fetchImpl,
		});

		const sentHeaders = (calls[0] as { init: RequestInit }).init.headers as Headers;
		expect(sentHeaders.get("x-api-key")).toBe("sk-ant-test");
		expect(sentHeaders.has("authorization")).toBe(false);
	});
});

describe("callClaude — onBody hook", () => {
	it("calls onBody with the raw body and forwards the transformed result", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const transformed = JSON.stringify({ mutated: true });
		const onBody = vi.fn((_raw: string) => transformed);

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: '{"original":true}',
			onBody,
			fetchImpl,
		});

		expect(onBody).toHaveBeenCalledWith('{"original":true}');
		expect((calls[0] as { init: RequestInit }).init.body).toBe(transformed);
	});

	it("returns 400 invalid_json when onBody returns null", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const onBody = vi.fn((_raw: string) => null);

		const res = await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: "not-json",
			onBody,
			fetchImpl,
		});

		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
		expect(calls).toHaveLength(0);
	});

	it("does NOT call onBody when body is undefined", async () => {
		const { fetchImpl } = buildFetchMock({ status: 200 });
		const onBody = vi.fn((_raw: string) => _raw);

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			onBody,
			fetchImpl,
		});

		expect(onBody).not.toHaveBeenCalled();
	});
});

describe("callClaude — upstream URL", () => {
	it("builds the upstream URL from pathSegments and strips the beta param", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "beta=foo&stream=true",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages?stream=true");
	});

	it("builds multi-segment upstream URL correctly", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages", "count_tokens"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: "{}",
			fetchImpl,
		});

		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
	});
});

describe("callClaude — onDebug", () => {
	it("fires onDebug after the upstream response arrives", async () => {
		const { fetchImpl } = buildFetchMock({ status: 200, body: "{}" });
		const debugCalls: Array<{ url: string; status: number }> = [];

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: "{}",
			fetchImpl,
			onDebug: (url, status) => {
				debugCalls.push({ url, status });
			},
		});

		expect(debugCalls).toEqual([
			{ url: "https://api.anthropic.com/v1/messages", status: 200 },
		]);
	});
});

describe("callClaude — filterResponseHeaders", () => {
	it("applies filterResponseHeaders to the upstream response", async () => {
		const { fetchImpl } = buildFetchMock({
			status: 200,
			body: "{}",
			headers: {
				"content-type": "application/json",
				"x-should-strip": "yes",
			},
		});

		const res = await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
			filterResponseHeaders: (headers) => {
				const out = new Headers(headers);
				out.delete("x-should-strip");
				return out;
			},
		});

		expect(res.headers.has("x-should-strip")).toBe(false);
		expect(res.headers.get("content-type")).toBe("application/json");
	});
});
