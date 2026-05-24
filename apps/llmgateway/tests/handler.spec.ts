import { afterEach, describe, expect, it, vi } from "vitest";

import handle from "../src/handler.js";

describe("handle — config errors", () => {
	const originalToken = process.env["ANTHROPIC_AUTH_TOKEN"];
	const originalKey = process.env["ANTHROPIC_API_KEY"];

	afterEach(() => {
		if (originalToken === undefined) {
			delete process.env["ANTHROPIC_AUTH_TOKEN"];
		} else {
			process.env["ANTHROPIC_AUTH_TOKEN"] = originalToken;
		}
		if (originalKey === undefined) {
			delete process.env["ANTHROPIC_API_KEY"];
		} else {
			process.env["ANTHROPIC_API_KEY"] = originalKey;
		}
	});

	it("returns 500 configuration_error when no credential is configured", async () => {
		delete process.env["ANTHROPIC_AUTH_TOKEN"];
		delete process.env["ANTHROPIC_API_KEY"];

		const req = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});
		const res = await handle(req);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe("configuration_error");
		expect(body.message).toMatch(/ANTHROPIC_AUTH_TOKEN/);
		expect(body.message).toMatch(/ANTHROPIC_API_KEY/);
	});
});

describe("handle — auth-mode selection", () => {
	const originalToken = process.env["ANTHROPIC_AUTH_TOKEN"];
	const originalKey = process.env["ANTHROPIC_API_KEY"];

	afterEach(() => {
		vi.unstubAllGlobals();
		if (originalToken === undefined) {
			delete process.env["ANTHROPIC_AUTH_TOKEN"];
		} else {
			process.env["ANTHROPIC_AUTH_TOKEN"] = originalToken;
		}
		if (originalKey === undefined) {
			delete process.env["ANTHROPIC_API_KEY"];
		} else {
			process.env["ANTHROPIC_API_KEY"] = originalKey;
		}
	});

	it("selects OAuth mode when ANTHROPIC_AUTH_TOKEN is set", async () => {
		process.env["ANTHROPIC_AUTH_TOKEN"] = "tok-test";
		delete process.env["ANTHROPIC_API_KEY"];
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));

		const req = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});
		const res = await handle(req);
		expect(res.status).not.toBe(500);
	});

	it("selects API-key mode when only ANTHROPIC_API_KEY is set", async () => {
		delete process.env["ANTHROPIC_AUTH_TOKEN"];
		process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));

		const req = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});
		const res = await handle(req);
		expect(res.status).not.toBe(500);
	});

	it("falls through to ANTHROPIC_API_KEY when ANTHROPIC_AUTH_TOKEN is empty", async () => {
		process.env["ANTHROPIC_AUTH_TOKEN"] = "";
		process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));

		const req = new Request("http://placeholder.local/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});
		const res = await handle(req);
		expect(res.status).not.toBe(500);
	});
});
