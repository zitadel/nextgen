import { describe, expect, it } from "vitest";

import { parseJsonObject, stableStringify, updateJsonPreservingOrder } from "../../../src/lib/json";

describe("updateJsonPreservingOrder", () => {
  it("preserves key order while applying the mutation", () => {
    const source = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "scripts": {}\n}\n';
    const out = updateJsonPreservingOrder(source, "package.json", (value) => {
      value.scripts = { dev: "ng serve" };
    });
    expect(Object.keys(JSON.parse(out) as Record<string, unknown>)).toEqual([
      "name",
      "version",
      "scripts",
    ]);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("keeps tab indentation", () => {
    const source = '{\n\t"name": "demo",\n\t"private": true\n}\n';
    const out = updateJsonPreservingOrder(source, "package.json", (value) => {
      value.extra = 1;
    });
    expect(out).toContain('\n\t"name"');
    expect(out).toContain('\n\t"extra"');
  });

  it("keeps a compact document compact", () => {
    const out = updateJsonPreservingOrder('{"name":"demo"}', "package.json", (value) => {
      value.extra = 1;
    });
    expect(out).toBe('{"name":"demo","extra":1}');
  });

  it("does not invent a trailing newline", () => {
    const out = updateJsonPreservingOrder('{\n  "name": "demo"\n}', "package.json", (value) => {
      value.extra = 1;
    });
    expect(out.endsWith("\n")).toBe(false);
    expect(out.endsWith("}")).toBe(true);
  });

  it("appends a key the source did not have at the end", () => {
    const source = '{\n  "version": "1.0.0",\n  "name": "demo"\n}\n';
    const out = updateJsonPreservingOrder(source, "package.json", (value) => {
      value.dependencies = { a: "1" };
    });
    expect(Object.keys(JSON.parse(out) as Record<string, unknown>)).toEqual([
      "version",
      "name",
      "dependencies",
    ]);
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
