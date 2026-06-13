import { generateCode, parseModule } from "magicast";
import { describe, expect, it } from "vitest";

import {
  ensureArrayItem,
  ensureEditableObject,
  importIsPresent,
  parseConfigModule,
  resolveDefaultExportObject,
} from "../../../../../../../src/lib/orca/patchers/rule/utils/magicast";

describe("parseConfigModule", () => {
  it("parses valid source", () => {
    const mod = parseConfigModule("export default {}", "vite.config.ts");
    expect(mod.exports.default).toBeDefined();
  });

  it("throws E_VALIDATION when the source is missing", () => {
    expect(() => parseConfigModule(undefined, "vite.config.ts")).toThrowError(/not found/);
  });

  it("throws E_VALIDATION on unparseable source", () => {
    expect(() => parseConfigModule("export default (((", "vite.config.ts")).toThrowError(
      /Could not parse/,
    );
  });

  it("rejects a CommonJS config with a targeted error", () => {
    expect(() =>
      parseConfigModule("module.exports = { server: {} };", "vite.config.cjs"),
    ).toThrowError(/CommonJS module/);
  });

  it("rejects a CommonJS config that uses exports.default", () => {
    expect(() =>
      parseConfigModule("exports.default = { server: {} };", "vite.config.cjs"),
    ).toThrowError(/CommonJS module/);
  });

  it("does not flag an ESM config that merely mentions module.exports in a comment", () => {
    const mod = parseConfigModule(
      "// migrated from module.exports\nexport default { server: {} };",
      "vite.config.ts",
    );
    expect(mod).toBeTruthy();
  });
});

describe("resolveDefaultExportObject", () => {
  it("reaches into a define-style call argument", () => {
    const mod = parseModule("export default defineConfig({ a: 1 })");
    const config = resolveDefaultExportObject(mod, "x.ts");
    config.b = 2;
    expect(generateCode(mod).code).toContain("b: 2");
  });

  it("returns a bare object export", () => {
    const mod = parseModule("export default { a: 1 }");
    expect(resolveDefaultExportObject(mod, "x.ts")).toBeDefined();
  });

  it("throws when the default export is not an editable object", () => {
    const mod = parseModule("export default base");
    expect(() => resolveDefaultExportObject(mod, "x.ts")).toThrowError(/Could not locate/);
  });
});

describe("importIsPresent", () => {
  it("detects a present / absent import by local name", () => {
    const mod = parseModule('import { readFileSync } from "node:fs";\nexport default {}');
    expect(importIsPresent(mod, "readFileSync")).toBe(true);
    expect(importIsPresent(mod, "writeFileSync")).toBe(false);
  });
});

describe("ensureArrayItem", () => {
  it("creates the array when absent", () => {
    const mod = parseModule("export default {}");
    const config = resolveDefaultExportObject(mod, "x.ts");
    ensureArrayItem(config, "modules", "zmod");
    expect(generateCode(mod).code).toContain("zmod");
  });

  it("appends once and is idempotent", () => {
    const mod = parseModule('export default { modules: ["a"] }');
    const config = resolveDefaultExportObject(mod, "x.ts");
    ensureArrayItem(config, "modules", "zmod");
    ensureArrayItem(config, "modules", "zmod");
    const code = generateCode(mod).code;
    expect(code).toContain("a");
    expect((code.match(/zmod/g) ?? []).length).toBe(1);
  });

  it("throws when the value is not an array", () => {
    const mod = parseModule("export default { modules: base }");
    const config = resolveDefaultExportObject(mod, "x.ts");
    expect(() => ensureArrayItem(config, "modules", "zmod")).toThrowError(/Could not add/);
  });
});

describe("ensureEditableObject", () => {
  it("creates the object when absent and returns a live reference", () => {
    const mod = parseModule("export default {}");
    const config = resolveDefaultExportObject(mod, "x.ts");
    const runtime = ensureEditableObject(config, "runtimeConfig");
    runtime.foo = "bar";
    expect(generateCode(mod).code).toContain('foo: "bar"');
  });

  it("throws when the value is not an inline object", () => {
    const mod = parseModule("export default { runtimeConfig: base }");
    const config = resolveDefaultExportObject(mod, "x.ts");
    expect(() => ensureEditableObject(config, "runtimeConfig")).toThrowError(/Could not edit/);
  });
});
