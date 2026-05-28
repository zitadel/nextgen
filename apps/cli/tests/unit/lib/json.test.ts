import { describe, expect, it } from "vitest";

import { parseJsonObject, sortValue, stableStringify } from "../../../src/lib/json";

describe("sortValue", () => {
  it("sorts object keys lexicographically", () => {
    const sorted = sortValue({ banana: 1, apple: 2, cherry: 3 });
    expect(Object.keys(sorted as Record<string, unknown>)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("sorts keys recursively at every depth", () => {
    const sorted = sortValue({
      z: { y: 1, x: 2 },
      a: { c: 3, b: 4 },
    });
    expect(Object.keys(sorted as Record<string, unknown>)).toEqual(["a", "z"]);
    const nested = (sorted as Record<string, Record<string, unknown>>).z;
    expect(Object.keys(nested)).toEqual(["x", "y"]);
  });

  it("preserves array order while sorting object elements within", () => {
    const sorted = sortValue([{ b: 1, a: 2 }, { d: 3, c: 4 }]);
    expect(Array.isArray(sorted)).toBe(true);
    const arr = sorted as Array<Record<string, unknown>>;
    expect(Object.keys(arr[0])).toEqual(["a", "b"]);
    expect(Object.keys(arr[1])).toEqual(["c", "d"]);
  });

  it("passes primitives through unchanged", () => {
    expect(sortValue(42)).toBe(42);
    expect(sortValue("hello")).toBe("hello");
    expect(sortValue(true)).toBe(true);
    expect(sortValue(null)).toBeNull();
    expect(sortValue(undefined)).toBeUndefined();
  });
});

describe("stableStringify", () => {
  it("produces 2-space indented JSON with sorted keys", () => {
    const out = stableStringify({ b: 1, a: 2 });
    expect(out).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  it("is stable regardless of input key insertion order", () => {
    const a = stableStringify({ x: 1, y: 2, z: 3 });
    const b = stableStringify({ z: 3, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("sorts nested objects but keeps array order", () => {
    const out = stableStringify({ list: [{ b: 1, a: 2 }], name: "x" });
    expect(out).toBe(
      '{\n  "list": [\n    {\n      "a": 2,\n      "b": 1\n    }\n  ],\n  "name": "x"\n}',
    );
  });
});

describe("parseJsonObject", () => {
  it("parses a JSON object", () => {
    expect(parseJsonObject('{"a":1,"b":"two"}', "config.json")).toEqual({
      a: 1,
      b: "two",
    });
  });

  it("throws a path-qualified error for a JSON array", () => {
    expect(() => parseJsonObject("[1,2,3]", "config.json")).toThrow(
      "config.json must contain a JSON object",
    );
  });

  it("throws a path-qualified error for a JSON scalar", () => {
    expect(() => parseJsonObject("42", "config.json")).toThrow(
      "config.json must contain a JSON object",
    );
  });

  it("throws a path-qualified error for JSON null", () => {
    expect(() => parseJsonObject("null", "config.json")).toThrow(
      "config.json must contain a JSON object",
    );
  });

  it("propagates the JSON.parse SyntaxError for invalid JSON", () => {
    expect(() => parseJsonObject("{ not json", "config.json")).toThrow(SyntaxError);
  });
});
