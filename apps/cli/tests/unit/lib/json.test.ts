import { describe, expect, it } from "vitest";

import { parseJsonObject, setTopLevelJsonKey, stableStringify } from "../../../src/lib/json";

describe("setTopLevelJsonKey", () => {
  it("splices one value and leaves every other byte untouched", () => {
    // Blank line, an inline nested object, and irregular spacing — all of it
    // must survive byte-for-byte because only `dependencies` is replaced.
    const source = `{
  "name": "demo",
  "engines": { "node": ">=20" },

  "scripts": {"dev": "next dev"},
  "dependencies": {
    "zzz": "1.0.0"
  }
}
`;
    const out = setTopLevelJsonKey(source, "package.json", "dependencies", {
      next: "^16",
      zzz: "1.0.0",
    });
    expect(out).toBe(`{
  "name": "demo",
  "engines": { "node": ">=20" },

  "scripts": {"dev": "next dev"},
  "dependencies": {
    "next": "^16",
    "zzz": "1.0.0"
  }
}
`);
  });

  it("appends a missing key after the last member", () => {
    const source = '{\n  "version": "1.0.0",\n  "name": "demo"\n}\n';
    const out = setTopLevelJsonKey(source, "package.json", "dependencies", { a: "1" });
    expect(out).toBe(
      '{\n  "version": "1.0.0",\n  "name": "demo",\n  "dependencies": {\n    "a": "1"\n  }\n}\n',
    );
  });

  it("inserts into an empty object", () => {
    const out = setTopLevelJsonKey("{}\n", "package.json", "scripts", { dev: "x" });
    expect(JSON.parse(out)).toEqual({ scripts: { dev: "x" } });
    expect(out.endsWith("\n")).toBe(true);
  });

  it("keeps tab indentation", () => {
    const source = '{\n\t"name": "demo",\n\t"private": true\n}\n';
    const out = setTopLevelJsonKey(source, "package.json", "scripts", { dev: "x" });
    expect(out).toContain('\n\t"name"');
    expect(out).toContain('\n\t"scripts"');
    expect(out).toContain('\n\t\t"dev"');
  });

  it("keeps a compact document compact", () => {
    const out = setTopLevelJsonKey('{"name":"demo"}', "package.json", "extra", 1);
    expect(out).toBe('{"name":"demo","extra":1}');
  });

  it("does not invent a trailing newline", () => {
    const out = setTopLevelJsonKey('{\n  "name": "demo"\n}', "package.json", "extra", 1);
    expect(out).toBe('{\n  "name": "demo",\n  "extra": 1\n}');
  });

  it("keeps CRLF line endings, including inside the spliced value", () => {
    const source = '{\r\n  "name": "demo",\r\n  "version": "1.0.0"\r\n}\r\n';
    const out = setTopLevelJsonKey(source, "package.json", "dependencies", { a: "1" });
    expect(out).toBe(
      '{\r\n  "name": "demo",\r\n  "version": "1.0.0",\r\n  "dependencies": {\r\n    "a": "1"\r\n  }\r\n}\r\n',
    );
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("is not fooled by key-looking strings inside values", () => {
    const source = '{\n  "description": "set \\"dependencies\\": here",\n  "dependencies": {}\n}\n';
    const out = setTopLevelJsonKey(source, "package.json", "dependencies", { a: "1" });
    const parsed = JSON.parse(out) as { description: string; dependencies: Record<string, string> };
    expect(parsed.description).toBe('set "dependencies": here');
    expect(parsed.dependencies).toEqual({ a: "1" });
  });

  it("replaces primitive and array values by exact span", () => {
    const source = '{\n  "private": true,\n  "workspaces": ["a", "b"],\n  "name": "demo"\n}\n';
    const out = setTopLevelJsonKey(source, "package.json", "private", false);
    expect(out).toBe('{\n  "private": false,\n  "workspaces": ["a", "b"],\n  "name": "demo"\n}\n');
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
