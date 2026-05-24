import { describe, expect, it } from "vitest";

import { ProxyService } from "../../src/lib/proxy.js";
import { buildFetchMock } from "../helpers/fetch-mock.js";

describe("ProxyService — allowedUrls", () => {
	it("allows a request when the URL pathname matches an allowed string", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const service = new ProxyService({
			allowedUrls: ["/v1/messages"],
			fetchImpl,
		});

		const res = await service.call(
			"https://api.anthropic.com/v1/messages",
			"POST",
			new Headers(),
			"{}",
		);

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
	});

	it("returns 404 when the pathname does not match any allowed URL", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200 });
		const service = new ProxyService({
			allowedUrls: ["/v1/messages"],
			fetchImpl,
		});

		const res = await service.call("https://api.anthropic.com/v1/models", "GET", new Headers());

		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toBe("not_found");
		expect(calls).toHaveLength(0);
	});

	it("allows a request matching an allowed RegExp", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const service = new ProxyService({
			allowedUrls: [/^\/v1\/messages(\/count_tokens)?$/],
			fetchImpl,
		});

		const res = await service.call(
			"https://api.anthropic.com/v1/messages/count_tokens",
			"POST",
			new Headers(),
			"{}",
		);

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
	});

	it("allows all URLs when allowedUrls is empty", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const service = new ProxyService({ allowedUrls: [], fetchImpl });

		const res = await service.call(
			"https://api.anthropic.com/v1/anything",
			"GET",
			new Headers(),
		);

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
	});

	it("allows all URLs when allowedUrls is not provided", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const service = new ProxyService({ fetchImpl });

		const res = await service.call(
			"https://api.anthropic.com/v1/anything",
			"GET",
			new Headers(),
		);

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
	});
});

describe("ProxyService — header stripping", () => {
	it("strips hop-by-hop and proxy-specific request headers before forwarding", async () => {
		const { fetchImpl, calls } = buildFetchMock({ status: 200, body: "{}" });
		const service = new ProxyService({ fetchImpl });

		await service.call(
			"https://api.anthropic.com/v1/messages",
			"POST",
			new Headers({
				host: "example.com",
				"content-length": "999",
				"transfer-encoding": "chunked",
				"x-keep": "kept",
			}),
			"{}",
		);

		const sent = (calls[0] as { init: RequestInit }).init!.headers as Headers;
		expect(sent.has("host")).toBe(false);
		expect(sent.has("content-length")).toBe(false);
		expect(sent.has("transfer-encoding")).toBe(false);
		expect(sent.get("x-keep")).toBe("kept");
	});

	it("strips content-encoding and content-length from the upstream response", async () => {
		const { fetchImpl } = buildFetchMock({
			status: 200,
			body: "{}",
			headers: {
				"content-type": "application/json",
				"content-encoding": "gzip",
				"content-length": "512",
			},
		});
		const service = new ProxyService({ fetchImpl });

		const res = await service.call(
			"https://api.anthropic.com/v1/messages",
			"GET",
			new Headers(),
		);

		expect(res.headers.has("content-encoding")).toBe(false);
		expect(res.headers.has("content-length")).toBe(false);
		expect(res.headers.get("content-type")).toBe("application/json");
	});
});
