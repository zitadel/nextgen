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

function sentHeaders(calls: Array<{ url: string; init: RequestInit | undefined }>): Headers {
	return (calls[0] as { init: RequestInit }).init.headers as Headers;
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

		expect(sentHeaders(calls).get("authorization")).toBe("Bearer oauth-token");
		expect(sentHeaders(calls).has("x-api-key")).toBe(false);
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

		expect(sentHeaders(calls).get("x-api-key")).toBe("sk-ant-test");
		expect(sentHeaders(calls).has("authorization")).toBe(false);
	});
});

describe("callClaude — OAuth beta header", () => {
	it("adds anthropic-beta: oauth-2025-04-20 when no beta header is present", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBe("oauth-2025-04-20");
	});

	it("appends oauth-2025-04-20 to an existing anthropic-beta value", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ "anthropic-beta": "prompt-caching-2024-07-31" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBe(
			"prompt-caching-2024-07-31,oauth-2025-04-20",
		);
	});

	it("does not duplicate oauth-2025-04-20 when already the only beta value", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ "anthropic-beta": "oauth-2025-04-20" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBe("oauth-2025-04-20");
	});

	it("does not duplicate oauth-2025-04-20 when already present alongside other values", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ "anthropic-beta": "foo, oauth-2025-04-20, bar" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBe("foo, oauth-2025-04-20, bar");
	});

	it("API key mode does not add the oauth beta header", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBeNull();
	});

	it("API key mode preserves an existing anthropic-beta header unmodified", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ "anthropic-beta": "prompt-caching-2024-07-31" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-beta")).toBe("prompt-caching-2024-07-31");
	});
});

describe("callClaude — anthropic-version", () => {
	it("adds the default anthropic-version when absent", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-version")).toBe("2023-06-01");
	});

	it("preserves a caller-supplied anthropic-version", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ "anthropic-version": "2024-01-01" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("anthropic-version")).toBe("2024-01-01");
	});
});

describe("callClaude — header immutability", () => {
	it("does not mutate the input Headers", async () => {
		const input = new Headers({ "x-keep": "ok" });
		const { fetchImpl } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: input,
			fetchImpl,
		});

		expect(input.has("authorization")).toBe(false);
		expect(input.has("x-api-key")).toBe(false);
		expect(input.get("x-keep")).toBe("ok");
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

	it("forwards the raw body unchanged when no onBody hook is supplied", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "POST",
			requestHeaders: new Headers(),
			body: '{"raw":true}',
			fetchImpl,
		});

		expect((calls[0] as { init: RequestInit }).init.body).toBe('{"raw":true}');
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

	it("preserves non-beta query parameters and omits the beta param", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "stream=true&beta=foo&extra=x",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		const url = new URL(calls[0]?.url ?? "");
		expect(url.searchParams.get("stream")).toBe("true");
		expect(url.searchParams.get("extra")).toBe("x");
		expect(url.searchParams.has("beta")).toBe(false);
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

	it("produces a clean URL with no trailing ? when search is empty", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
	});

	it("produces a clean URL when the only query param is stripped", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "beta=foo",
			method: "GET",
			requestHeaders: new Headers(),
			fetchImpl,
		});

		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
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

describe("callClaude — client Authorization stripping", () => {
	it("replaces a client-supplied Authorization with gateway OAuth auth", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: OAUTH_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ authorization: "Bearer client-token" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).get("authorization")).toBe("Bearer oauth-token");
	});

	it("removes a client-supplied Authorization in API-key mode", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });

		await callClaude({
			auth: API_KEY_AUTH,
			pathSegments: ["messages"],
			search: "",
			method: "GET",
			requestHeaders: new Headers({ authorization: "Bearer client-token" }),
			fetchImpl,
		});

		expect(sentHeaders(calls).has("authorization")).toBe(false);
		expect(sentHeaders(calls).get("x-api-key")).toBe("sk-ant-test");
	});
});
