import { afterEach, describe, expect, it } from "vitest";

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
