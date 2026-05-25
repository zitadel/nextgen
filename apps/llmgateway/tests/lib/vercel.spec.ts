import { describe, expect, it } from "vitest";

import { persistTokensToVercel } from "../../src/lib/vercel.js";

function buildVercelMock(): {
	fetchImpl: typeof fetch;
	calls: Array<{ url: string; method: string; body?: unknown }>;
} {
	const calls: Array<{ url: string; method: string; body?: unknown }> = [];
	const fetchImpl: typeof fetch = async (url, init = {}) => {
		const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		const method = (init.method ?? "GET").toUpperCase();
		const body =
			typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
		calls.push({ url: urlStr, method, body });

		if (urlStr.includes("/env") && method === "GET") {
			return new Response(
				JSON.stringify({
					envs: [
						{ id: "env-at-id", key: "ANTHROPIC_AUTH_TOKEN" },
						{ id: "env-rt-id", key: "ANTHROPIC_REFRESH_TOKEN" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("{}", { status: 200 });
	};
	return { fetchImpl, calls };
}

describe("persistTokensToVercel — no-op when env vars are absent", () => {
	it("does nothing when VERCEL_TOKEN is not set", async () => {
		const { fetchImpl, calls } = buildVercelMock();
		const env = { VERCEL_TEAM_ID: "team_x", VERCEL_PROJECT_ID: "prj_y" };
		await persistTokensToVercel("at", "rt", fetchImpl, env);
		expect(calls).toHaveLength(0);
	});

	it("does nothing when VERCEL_TEAM_ID is not set", async () => {
		const { fetchImpl, calls } = buildVercelMock();
		const env = { VERCEL_TOKEN: "tok", VERCEL_PROJECT_ID: "prj_y" };
		await persistTokensToVercel("at", "rt", fetchImpl, env);
		expect(calls).toHaveLength(0);
	});

	it("does nothing when VERCEL_PROJECT_ID is not set", async () => {
		const { fetchImpl, calls } = buildVercelMock();
		const env = { VERCEL_TOKEN: "tok", VERCEL_TEAM_ID: "team_x" };
		await persistTokensToVercel("at", "rt", fetchImpl, env);
		expect(calls).toHaveLength(0);
	});
});

describe("persistTokensToVercel — success path", () => {
	const ENV = { VERCEL_TOKEN: "tok", VERCEL_TEAM_ID: "team_x", VERCEL_PROJECT_ID: "prj_y" };

	it("fetches the env var list then PATCHes both token env vars", async () => {
		const { fetchImpl, calls } = buildVercelMock();
		await persistTokensToVercel("new-at", "new-rt", fetchImpl, ENV);

		// 1 GET + 2 PATCHes
		expect(calls).toHaveLength(3);
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toContain("/env");
		expect(calls[0]?.url).toContain("team_x");

		const patches = calls.slice(1);
		expect(patches.every((c) => c.method === "PATCH")).toBe(true);
		expect(patches.some((c) => c.url.includes("env-at-id"))).toBe(true);
		expect(patches.some((c) => c.url.includes("env-rt-id"))).toBe(true);
	});

	it("writes the correct token values", async () => {
		const { fetchImpl, calls } = buildVercelMock();
		await persistTokensToVercel("new-access", "new-refresh", fetchImpl, ENV);

		const atPatch = calls.find((c) => c.url.includes("env-at-id"));
		const rtPatch = calls.find((c) => c.url.includes("env-rt-id"));
		expect((atPatch?.body as { value: string }).value).toBe("new-access");
		expect((rtPatch?.body as { value: string }).value).toBe("new-refresh");
	});

	it("does not throw when the list endpoint returns non-2xx", async () => {
		const fetchImpl: typeof fetch = async () => new Response("{}", { status: 500 });
		await expect(persistTokensToVercel("at", "rt", fetchImpl, ENV)).resolves.toBeUndefined();
	});

	it("does not throw when a PATCH fails", async () => {
		const fetchImpl: typeof fetch = async (url, init = {}) => {
			const urlStr = typeof url === "string" ? url : (url as URL).href;
			if (urlStr.includes("/env") && (init.method ?? "GET") === "GET") {
				return new Response(
					JSON.stringify({
						envs: [{ id: "env-at-id", key: "ANTHROPIC_AUTH_TOKEN" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("error", { status: 403 });
		};
		await expect(persistTokensToVercel("at", "rt", fetchImpl, ENV)).resolves.toBeUndefined();
	});
});
