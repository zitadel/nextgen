import { describe, expect, it } from "vitest";

import {
	RFC_7230_HOP_BY_HOP,
	effectiveHopByHopHeaders,
	filterHeaders,
} from "../../src/lib/proxy.js";

describe("RFC_7230_HOP_BY_HOP", () => {
	it("contains the eight RFC 7230 §6.1 hop-by-hop headers", () => {
		for (const name of [
			"connection",
			"keep-alive",
			"proxy-authenticate",
			"proxy-authorization",
			"te",
			"trailer",
			"transfer-encoding",
			"upgrade",
		]) {
			expect(RFC_7230_HOP_BY_HOP.has(name)).toBe(true);
		}
	});

	it("uses lowercase names", () => {
		for (const name of RFC_7230_HOP_BY_HOP) {
			expect(name).toBe(name.toLowerCase());
		}
	});
});

describe("effectiveHopByHopHeaders", () => {
	it("returns the static RFC set when no Connection header is present", () => {
		const out = effectiveHopByHopHeaders(new Headers());
		expect(out).toBe(RFC_7230_HOP_BY_HOP);
	});

	it("expands with names listed in the Connection header (RFC 7230 §6.1)", () => {
		const input = new Headers({ connection: "x-custom-extra, x-another" });
		const out = effectiveHopByHopHeaders(input);
		expect(out.has("x-custom-extra")).toBe(true);
		expect(out.has("x-another")).toBe(true);
		expect(out.has("connection")).toBe(true);
		expect(out.has("transfer-encoding")).toBe(true);
	});

	it("ignores bare connection-options (close, keep-alive) as not-headers", () => {
		const input = new Headers({ connection: "close, x-trace-id" });
		const out = effectiveHopByHopHeaders(input);
		expect(out.has("x-trace-id")).toBe(true);
	});

	it("returns the static RFC set when Connection lists only connection-options", () => {
		const input = new Headers({ connection: "close, keep-alive" });
		const out = effectiveHopByHopHeaders(input);
		expect(out).toBe(RFC_7230_HOP_BY_HOP);
	});

	it("lowercases names listed in the Connection header", () => {
		const input = new Headers({ connection: "X-Mixed-Case" });
		const out = effectiveHopByHopHeaders(input);
		expect(out.has("x-mixed-case")).toBe(true);
		expect(out.has("X-Mixed-Case")).toBe(false);
	});

	it("ignores empty entries in a comma-separated Connection value", () => {
		const input = new Headers({ connection: "x-keep, ,  ,x-other" });
		const out = effectiveHopByHopHeaders(input);
		expect(out.has("x-keep")).toBe(true);
		expect(out.has("x-other")).toBe(true);
		expect(out.has("")).toBe(false);
	});
});

describe("filterHeaders", () => {
	it("returns a new Headers without entries in the strip set", () => {
		const input = new Headers({ "x-keep": "1", "x-drop": "2" });
		const out = filterHeaders(input, new Set(["x-drop"]));
		expect(out.get("x-keep")).toBe("1");
		expect(out.has("x-drop")).toBe(false);
	});

	it("matches strip-set entries case-insensitively", () => {
		const input = new Headers();
		input.append("Authorization", "Bearer x");
		const out = filterHeaders(input, new Set(["authorization"]));
		expect(out.has("authorization")).toBe(false);
	});

	it("does not mutate the input", () => {
		const input = new Headers({ "x-drop": "1" });
		filterHeaders(input, new Set(["x-drop"]));
		expect(input.get("x-drop")).toBe("1");
	});

	it("returns an empty Headers when every entry is stripped", () => {
		const input = new Headers({ a: "1", b: "2" });
		const out = filterHeaders(input, new Set(["a", "b"]));
		expect([...out.entries()]).toEqual([]);
	});
});
