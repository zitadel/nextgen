import { generateCode } from "magicast";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigModule } from "@/lib/orca/patchers/rule/utils/config-module";

describe("ConfigModule.open", () => {
  it("parses valid source", () => {
    const file = ConfigModule.open("export default {}", "vite.config.ts");

    expect((file.module.exports as { default?: unknown }).default).toBeDefined();
    expect(file.source).toBe("export default {}");
  });

  it("throws E_VALIDATION when the source is missing", () => {
    expect(() => ConfigModule.open(undefined, "vite.config.ts")).toThrowError(/not found/);
  });

  it("throws E_VALIDATION on unparseable source", () => {
    expect(() => ConfigModule.open("export default (((", "vite.config.ts")).toThrowError(
      /Could not parse/,
    );
  });

  it("rejects a CommonJS config with a targeted error", () => {
    expect(() =>
      ConfigModule.open("module.exports = { server: {} };", "vite.config.cjs"),
    ).toThrowError(/CommonJS module/);
  });

  it("rejects a CommonJS config that uses exports.default", () => {
    expect(() =>
      ConfigModule.open("exports.default = { server: {} };", "vite.config.cjs"),
    ).toThrowError(/CommonJS module/);
  });

  it("rejects a CommonJS config that starts with a comment", () => {
    expect(() =>
      ConfigModule.open("// the config\nmodule.exports = { server: {} };", "vite.config.cjs"),
    ).toThrowError(/CommonJS module/);
  });

  it("does not flag a block comment line that starts with module.exports", () => {
    const file = ConfigModule.open(
      "/*\nmodule.exports = {};\n*/\nexport default { server: {} };",
      "vite.config.ts",
    );

    expect(file).toBeTruthy();
  });

  it("does not flag an ESM config that merely mentions module.exports in a comment", () => {
    const file = ConfigModule.open(
      "// migrated from module.exports\nexport default { server: {} };",
      "vite.config.ts",
    );

    expect(file).toBeTruthy();
  });

  it("does not flag an ESM config with module.exports inside a string literal", () => {
    const file = ConfigModule.open(
      'export default { note: "set via module.exports = {} in the old config" };',
      "vite.config.ts",
    );

    expect(file).toBeTruthy();
  });
});

describe("ConfigModule#exportedObject", () => {
  it("reaches into a define-style call argument", () => {
    const file = ConfigModule.open("export default defineConfig({ a: 1 })", "x.ts");
    const config = file.exportedObject();
    config.b = 2;

    expect(generateCode(file.module).code).toContain("b: 2");
  });

  it("returns a bare object export", () => {
    const file = ConfigModule.open("export default { a: 1 }", "x.ts");

    expect(file.exportedObject()).toBeDefined();
  });

  it("throws when the default export is not an editable object", () => {
    const file = ConfigModule.open("export default base", "x.ts");

    expect(() => file.exportedObject()).toThrowError(/Could not locate/);
  });

  it("throws when there is no default export", () => {
    const file = ConfigModule.open("export const a = 1;", "x.ts");

    expect(() => file.exportedObject()).toThrowError(/Could not locate/);
  });
});

describe("ConfigModule#objectAt", () => {
  it("returns a live reference to an object the caller created", () => {
    const file = ConfigModule.open("export default {}", "x.ts");
    const config = file.exportedObject();
    config.runtimeConfig ??= {};
    file.objectAt(config, "runtimeConfig").foo = "bar";

    expect(generateCode(file.module).code).toContain('foo: "bar"');
  });

  it("throws when the value is not an inline object", () => {
    const file = ConfigModule.open("export default { runtimeConfig: base }", "x.ts");

    expect(() => file.objectAt(file.exportedObject(), "runtimeConfig")).toThrowError(
      /Could not edit/,
    );
  });

  it("throws when the key is absent", () => {
    const file = ConfigModule.open("export default {}", "x.ts");

    expect(() => file.objectAt(file.exportedObject(), "runtimeConfig")).toThrowError(
      /Could not edit/,
    );
  });
});

describe("ConfigModule#arrayAt", () => {
  it("returns a live array that keeps its items", () => {
    const file = ConfigModule.open('export default { modules: ["a"] }', "x.ts");
    const modules = file.arrayAt(file.exportedObject(), "modules");
    modules.push("zmod");

    expect(modules.includes("a")).toBe(true);
    expect(generateCode(file.module).code).toContain('"a", "zmod"');
  });

  it("returns an array the caller created", () => {
    const file = ConfigModule.open("export default {}", "x.ts");
    const config = file.exportedObject();
    config.modules ??= [];
    file.arrayAt(config, "modules").push("zmod");

    expect(generateCode(file.module).code).toContain('modules: ["zmod"]');
  });

  it("throws when the value is not an array literal", () => {
    const file = ConfigModule.open("export default { modules: base }", "x.ts");

    expect(() => file.arrayAt(file.exportedObject(), "modules")).toThrowError(/Could not edit/);
  });
});

describe("ConfigModule#render", () => {
  it("returns the source untouched when nothing changed", () => {
    const source = "export default {  a:1 }";
    const file = ConfigModule.open(source, "x.ts");

    expect(file.render(false)).toBe(source);
  });

  it("ends a changed config in a newline when the source had none", () => {
    const file = ConfigModule.open("export default {}", "x.ts");
    file.exportedObject().a = 1;

    expect(file.render(true)).toBe("export default {\n  a: 1\n};\n");
  });

  it.for(["export default {}", "export default {}\n", "export default {}\n\n"])(
    "ends a changed config exactly as the old tail did for %j",
    (source) => {
      const file = ConfigModule.open(source, "x.ts");
      file.exportedObject().a = 1;
      const { code } = generateCode(file.module);

      expect(file.render(true)).toBe(code.endsWith("\n") ? code : `${code}\n`);
    },
  );

  describe("when the edit leaves code that no longer parses", () => {
    afterEach(() => {
      vi.doUnmock("magicast");
      vi.resetModules();
    });

    it("throws instead of returning it", async () => {
      vi.resetModules();
      vi.doMock("magicast", async (importOriginal) => {
        return {
          ...(await importOriginal<typeof import("magicast")>()),
          generateCode: () => ({ code: "(((" }),
        };
      });
      const { ConfigModule: Mocked } = await import("@/lib/orca/patchers/rule/utils/config-module");
      const file = Mocked.open("export default {}", "x.ts");

      expect(() => file.render(true)).toThrowError(/Could not write/);
    });
  });
});
