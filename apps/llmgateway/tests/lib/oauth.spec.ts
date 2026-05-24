import { describe, expect, it } from "vitest";

import { refreshOAuthToken } from "../../src/lib/oauth.js";

function buildRefreshMock(options: {
	status: number;
	body?: unknown;
}): typeof fetch {
	return async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
		new Response(
			options.body !== undefined ? JSON.stringify(options.body) : "",
			{ status: options.status, headers: { "content-type": "application/json" } },
		);
}

describe("refreshOAuthToken — success", () => {
	it("returns accessToken and refreshToken from a 200 response", async () => {
		const mock = buildRefreshMock({
			status: 200,
			body: {
				access_token: "new-access",
				refresh_token: "new-refresh",
				expires_in: 3600,
				token_type: "Bearer",
			},
		});

		const result = await refreshOAuthToken("old-refresh", mock);

		expect(result.accessToken).toBe("new-access");
		expect(result.refreshToken).toBe("new-refresh");
	});

	it("sends the refresh_token and client_id in the POST body", async () => {
		let capturedBody: unknown;
		const mock: typeof fetch = async (_url, init) => {
			capturedBody = JSON.parse((init?.body as string) ?? "{}");
			return new Response(
				JSON.stringify({ access_token: "a", refresh_token: "r" }),
				{ status: 200 },
			);
		};

		await refreshOAuthToken("my-refresh-token", mock);

		expect(capturedBody).toMatchObject({
			grant_type: "refresh_token",
			refresh_token: "my-refresh-token",
			client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		});
	});
});

describe("refreshOAuthToken — failure", () => {
	it("throws when the token endpoint returns a non-2xx status", async () => {
		const mock = buildRefreshMock({ status: 400, body: { error: "invalid_grant" } });

		await expect(refreshOAuthToken("bad-token", mock)).rejects.toThrow(
			/OAuth token refresh failed with status 400/,
		);
	});

	it("throws when the response is 401", async () => {
		const mock = buildRefreshMock({ status: 401, body: { error: "unauthorized" } });

		await expect(refreshOAuthToken("expired-token", mock)).rejects.toThrow(
			/OAuth token refresh failed with status 401/,
		);
	});

	it("throws when the response body is missing access_token", async () => {
		const mock = buildRefreshMock({
			status: 200,
			body: { refresh_token: "r" }, // missing access_token
		});

		await expect(refreshOAuthToken("rt", mock)).rejects.toThrow(
			/unexpected shape/,
		);
	});

	it("throws when the response body is missing refresh_token", async () => {
		const mock = buildRefreshMock({
			status: 200,
			body: { access_token: "a" }, // missing refresh_token
		});

		await expect(refreshOAuthToken("rt", mock)).rejects.toThrow(
			/unexpected shape/,
		);
	});

	it("throws on network failure", async () => {
		const mock: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};

		await expect(refreshOAuthToken("rt", mock as typeof fetch)).rejects.toThrow("fetch failed");
	});
});
