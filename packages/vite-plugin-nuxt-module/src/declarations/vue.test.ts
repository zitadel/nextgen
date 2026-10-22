import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_TSCONFIG, fixture } from "../__tests__/fixture.ts";
import { requiredVueTools, vueTools } from "./vue.ts";

afterEach(() => {
  vi.doUnmock("node:module");
  vi.resetModules();
});

describe("vueTools", () => {
  it("loads the TypeScript vue-tsc runs on, not the package's own copy", () => {
    const vueTsc = createRequire(import.meta.url).resolve("vue-tsc/package.json");
    expect(vueTools(fixture({ "package.json": "{}" }))?.ts).toBe(
      createRequire(vueTsc)("typescript"),
    );
  });

  it("creates a program that reads the .vue files the sources import", () => {
    const root = fixture({
      "package.json": JSON.stringify({ name: "fx", type: "module" }),
      "tsconfig.json": JSON.stringify({
        ...JSON.parse(FIXTURE_TSCONFIG),
        include: ["src/**/*.ts", "src/**/*.vue"],
      }),
      "src/Comp.vue": '<script setup lang="ts">\nconst label: string = 1;\n</script>\n',
      "src/index.ts": 'export { default as Comp } from "./Comp.vue";\n',
    });
    const tools = vueTools(root);
    const tsconfig = join(root, "tsconfig.json");
    const options = { strict: true, noEmit: true, types: [] };
    const program = tools?.createProgram(tsconfig)({
      rootNames: [join(root, "src/index.ts")],
      options,
      host: tools.ts.createCompilerHost(options),
    });
    const errors = program && tools?.ts.getPreEmitDiagnostics(program);
    expect(errors?.map((d) => d.code)).toEqual([2322]);
  });

  it("is undefined without vue-tsc", async () => {
    vi.doMock("node:module", () => ({
      createRequire: () => ({
        resolve: () => {
          throw new Error("Cannot find module 'vue-tsc/package.json'");
        },
      }),
    }));
    const { vueTools: withoutVueTsc } = await import("./vue.ts");
    expect(withoutVueTsc(tmpdir())).toBeUndefined();
  });
});

describe("requiredVueTools", () => {
  it("returns the tools when vue-tsc is installed", () => {
    expect(requiredVueTools(tmpdir(), "typing .vue files").ts).toBeDefined();
  });

  it("names what to install when vue-tsc is not", async () => {
    vi.doMock("node:module", () => ({
      createRequire: () => ({
        resolve: () => {
          throw new Error("Cannot find module 'vue-tsc/package.json'");
        },
      }),
    }));
    const { requiredVueTools: withoutVueTsc } = await import("./vue.ts");
    expect(() =>
      withoutVueTsc(tmpdir(), "declarations: .vue sources are typed by vue-tsc"),
    ).toThrow("declarations: .vue sources are typed by vue-tsc; install vue-tsc");
  });
});
