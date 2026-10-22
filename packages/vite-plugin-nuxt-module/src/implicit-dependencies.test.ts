import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildFixture } from "./__tests__/fixture.ts";
import { IMPLICIT_DEPENDENCY } from "./defaults.ts";
import { nodeModulesPackage } from "./implicit-dependencies.ts";
import type { NuxtModuleOptions } from "./options.ts";

const dirs: string[] = [];
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-implicit-test-")));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A module importing `helper`, a package it lists only under `devDependencies`. */
const moduleWithDevDependency = {
  "package.json": JSON.stringify({
    name: "mod",
    type: "module",
    devDependencies: { helper: "*" },
  }),
  "tsconfig.json": "{}",
  "src/module.ts":
    'import { help } from "helper";\nconst module = () => help();\nexport default module;\n',
  "node_modules/helper/package.json": JSON.stringify({
    name: "helper",
    type: "module",
    exports: { ".": "./index.js" },
  }),
  "node_modules/helper/index.js": "export const help = () => 1;\n",
};

async function buildModule(root: string, options: NuxtModuleOptions = {}) {
  await buildFixture(root, { runtimeDir: false, dts: false, ...options });
}

describe("nodeModulesPackage", () => {
  it.each([
    ["/w/node_modules/lit/index.js", "lit"],
    ["/w/node_modules/.pnpm/a@1/node_modules/@scope/pkg/dist/x.js?v=1", "@scope/pkg"],
    ["/w/src/module.ts", undefined],
  ])("names the package of %s", (id, expected) => {
    expect(nodeModulesPackage(id)).toBe(expected);
  });
});

describe("implicitDependencies", () => {
  it("fails a build that inlines a package the module does not depend on", async () => {
    await expect(buildModule(tree(moduleWithDevDependency))).rejects.toThrow(
      /Implicitly bundling "helper"/,
    );
  }, 60_000);

  it("inlines it anyway when its warning code is allowed", async () => {
    const root = tree(moduleWithDevDependency);
    await buildModule(root, { allowWarnings: [IMPLICIT_DEPENDENCY] });
    expect(readFileSync(join(root, "dist/module.mjs"), "utf8")).toContain("const help = ");
  }, 60_000);

  it("inlines a package listed in bundle", async () => {
    const root = tree(moduleWithDevDependency);
    await buildModule(root, { bundle: ["helper"] });
    expect(readFileSync(join(root, "dist/module.mjs"), "utf8")).toContain("const help = ");
  }, 60_000);
});
