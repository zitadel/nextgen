import { describe, expect, it } from "vitest";

import { edgeProject } from "./vitest.shared.mjs";

const [plugin] = edgeProject({ include: ["vitest.shared.test.mjs"] }).plugins;
const transform = (code, id = "/repo/packages/sdk/src/entry.ts") => plugin.transform(code, id);

describe("edgeProject", () => {
  it("runs the edge-runtime environment with dependencies inlined", () => {
    const { test } = edgeProject({ include: ["vitest.shared.test.mjs"] });
    expect(test).toMatchObject({
      name: "edge",
      environment: "edge-runtime",
      server: { deps: { inline: true } },
    });
  });

  it("keeps the package's own plugins ahead of the built-in check", () => {
    const own = { name: "own" };
    const { plugins } = edgeProject({ include: ["vitest.shared.test.mjs"], plugins: [own] });
    expect(plugins.map((entry) => entry.name)).toEqual(["own", "edge-reject-node-builtins"]);
  });

  it("lets a polyfilled dependency keep its built-ins", () => {
    const { plugins } = edgeProject({
      include: ["vitest.shared.test.mjs"],
      polyfilledPackages: ["svelte"],
    });
    const check = plugins.at(-1);
    const code = 'import { AsyncLocalStorage } from "node:async_hooks";';
    expect(check.transform(code, "/r/node_modules/svelte/src/ctx.js")).toBeNull();
    expect(() => check.transform(code, "/r/node_modules/other/src/ctx.js")).toThrow(/edge/);
  });

  it("fails at config load when no spec matches", () => {
    expect(() => edgeProject({ include: ["nothing/**/*.spec.ts"] })).toThrow(/no spec matches/);
  });

  describe("node built-ins in code under test", () => {
    it.each([
      ['import { readFileSync } from "node:fs";'],
      ['import "node:async_hooks";'],
      ['import { createHash } from "crypto";'],
      ['export { join } from "node:path/posix";'],
      ['const { AsyncLocalStorage } = await import("node:async_hooks");'],
    ])("rejects %s", (code) => {
      expect(() => transform(code)).toThrow(/must run on the edge/);
    });

    it.each([
      ['import { verifyJwt } from "@zitadel/sdk-core/jwt";'],
      ['import { ufo } from "ufo";'],
      ['import { x } from "./node-fs.js";'],
      ['const label = "node:fs is not imported here";'],
    ])("lets %s through", (code) => {
      expect(transform(code)).toBeNull();
    });

    it.each([
      ["/repo/packages/sdk/src/jwt.spec.ts"],
      ["/repo/packages/sdk/src/__tests__/middleware.test.ts"],
      ["/repo/packages/sdk/src/__tests__/stubs/server-only.ts"],
      ["/repo/packages/sdk/src/test-setup.ts"],
    ])("leaves the test file %s its built-ins", (id) => {
      expect(transform('import { createSign } from "node:crypto";', id)).toBeNull();
    });
  });
});
