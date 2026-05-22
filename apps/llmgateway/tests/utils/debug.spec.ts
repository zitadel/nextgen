import { describe, expect, it } from "vitest";

import { isDebugEnabled, truncateForLog } from "../../src/utils/debug.js";

describe("isDebugEnabled", () => {
	it("returns true when NODE_ENV is unset", () => {
		expect(isDebugEnabled({})).toBe(true);
	});

	it("returns true for development", () => {
		expect(isDebugEnabled({ NODE_ENV: "development" })).toBe(true);
	});

	it("returns true for any non-production value", () => {
		expect(isDebugEnabled({ NODE_ENV: "test" })).toBe(true);
		expect(isDebugEnabled({ NODE_ENV: "preview" })).toBe(true);
	});

	it("returns false when NODE_ENV is exactly 'production'", () => {
		expect(isDebugEnabled({ NODE_ENV: "production" })).toBe(false);
	});
});

describe("truncateForLog", () => {
	it("returns the original string when under the limit", () => {
		expect(truncateForLog("hello", 10)).toBe("hello");
	});

	it("truncates with an ellipsis marker when over the limit", () => {
		const input = "x".repeat(50);
		const out = truncateForLog(input, 10);
		expect(out.startsWith("x".repeat(10))).toBe(true);
		expect(out).toContain("[truncated]");
	});

	it("defaults the limit to 2000 characters", () => {
		const exact = "x".repeat(2000);
		expect(truncateForLog(exact)).toBe(exact);
		const over = "x".repeat(2001);
		expect(truncateForLog(over)).toContain("[truncated]");
	});

	it("handles empty strings", () => {
		expect(truncateForLog("", 10)).toBe("");
	});
});
