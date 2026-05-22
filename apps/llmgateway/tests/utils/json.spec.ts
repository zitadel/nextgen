import { describe, expect, it } from "vitest";

import { isPlainObject, tryParseJson } from "../../src/utils/json.js";

describe("tryParseJson", () => {
	it("returns ok:true with the parsed value for valid JSON", () => {
		const result = tryParseJson<{ a: number }>('{"a":1}');
		expect(result).toEqual({ ok: true, value: { a: 1 } });
	});

	it("returns ok:false with a SyntaxError for malformed JSON", () => {
		const result = tryParseJson("not-json");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(SyntaxError);
		}
	});

	it("parses primitives that are valid JSON", () => {
		expect(tryParseJson("null")).toEqual({ ok: true, value: null });
		expect(tryParseJson("true")).toEqual({ ok: true, value: true });
		expect(tryParseJson("42")).toEqual({ ok: true, value: 42 });
		expect(tryParseJson('"hi"')).toEqual({ ok: true, value: "hi" });
	});

	it("fails on the empty string (JSON.parse rejects it)", () => {
		expect(tryParseJson("").ok).toBe(false);
	});
});

describe("isPlainObject", () => {
	it("returns true for plain object literals", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject({ a: 1 })).toBe(true);
	});

	it("returns false for arrays", () => {
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject([1, 2, 3])).toBe(false);
	});

	it("returns false for null", () => {
		expect(isPlainObject(null)).toBe(false);
	});

	it("returns false for primitives", () => {
		expect(isPlainObject(1)).toBe(false);
		expect(isPlainObject("s")).toBe(false);
		expect(isPlainObject(true)).toBe(false);
		expect(isPlainObject(undefined)).toBe(false);
	});
});
