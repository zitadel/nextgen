import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fixture } from "../__tests__/fixture.ts";
import { selfReferenceOptions, typesTarget } from "./self-reference.ts";

function selfReferencing(
  exportsMap: unknown,
  tsconfig: Record<string, unknown> = {},
  files: Record<string, string> = {},
): string {
  const root = fixture({
    "package.json": JSON.stringify({ name: "pkg", exports: exportsMap }),
    "src/config.tsx": "export default 1;",
    "src/index.ts": 'export { default as config } from "pkg/config";',
    "tsconfig.json": JSON.stringify(tsconfig),
    ...files,
  });
  return root;
}

describe("typesTarget", () => {
  it.each([
    ["./dist/index.d.ts", "./dist/index.d.ts"],
    ["./dist/index.js", undefined],
    [
      { import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" } },
      "./dist/index.d.mts",
    ],
  ])("finds the types target of %j", (entry, expected) => {
    expect(typesTarget(entry)).toBe(expected);
  });
});

describe("selfReferenceOptions", () => {
  it("maps an exports subpath whose types live in the declaration output to its source", () => {
    const root = selfReferencing({
      "./config": { types: "./dist/types/config.d.ts", default: "./dist/config.js" },
    });
    const options = selfReferenceOptions(
      root,
      join(root, "dist/types"),
      join(root, "src"),
      join(root, "tsconfig.json"),
    );
    expect(options.compilerOptions?.paths["pkg/config"]).toEqual([join(root, "src/config.tsx")]);
  });

  it("maps an exports subpath to the entry of that name when it is named apart from its source", () => {
    const root = selfReferencing(
      { "./config": { types: "./dist/config.d.mts" } },
      {},
      { "src/cfg/main.ts": "export default 1;" },
    );
    const options = selfReferenceOptions(
      root,
      join(root, "dist"),
      join(root, "src"),
      join(root, "tsconfig.json"),
      { config: join(root, "src/cfg/main.ts") },
    );
    expect(options.compilerOptions?.paths["pkg/config"]).toEqual([join(root, "src/cfg/main.ts")]);
  });

  it("keeps the self-reference a bare specifier in the declarations", () => {
    const root = selfReferencing({ "./config": { types: "./dist/types/config.d.ts" } });
    const options = selfReferenceOptions(
      root,
      join(root, "dist/types"),
      join(root, "src"),
      join(root, "tsconfig.json"),
    );
    expect(options.aliasesExclude?.some((r) => r.test("pkg/config"))).toBe(true);
  });

  it("keeps the tsconfig's own paths next to the self-references", () => {
    const root = selfReferencing(
      { "./config": { types: "./dist/types/config.d.ts" } },
      { compilerOptions: { paths: { "~/*": ["./src/*"] } } },
    );
    const options = selfReferenceOptions(
      root,
      join(root, "dist/types"),
      join(root, "src"),
      join(root, "tsconfig.json"),
    );
    expect(options.compilerOptions?.paths["~/*"]).toEqual([join(root, "src/*")]);
  });

  it("keeps the paths a tsconfig inherits through extends", () => {
    const root = selfReferencing(
      { "./config": { types: "./dist/types/config.d.ts" } },
      { extends: "./tsconfig.base.json" },
      {
        "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["src/*"] } } }),
      },
    );
    const options = selfReferenceOptions(
      root,
      join(root, "dist/types"),
      join(root, "src"),
      join(root, "tsconfig.json"),
    );
    expect(options.compilerOptions?.paths["~/*"]).toEqual([join(root, "src/*")]);
  });

  it("adds nothing when no source imports the package's own name", () => {
    const root = selfReferencing(
      { "./config": { types: "./dist/types/config.d.ts" } },
      {},
      { "src/index.ts": "export const a = 1;" },
    );
    expect(
      selfReferenceOptions(
        root,
        join(root, "dist/types"),
        join(root, "src"),
        join(root, "tsconfig.json"),
      ),
    ).toEqual({});
  });

  it("keeps the own paths of a tsconfig whose comments follow a path pattern", () => {
    const root = selfReferencing(
      { "./config": { types: "./dist/types/config.d.ts" } },
      {},
      {
        "tsconfig.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } /* aliases */ } }',
      },
    );
    const options = selfReferenceOptions(
      root,
      join(root, "dist/types"),
      join(root, "src"),
      join(root, "tsconfig.json"),
    );
    expect(options.compilerOptions?.paths["~/*"]).toEqual([join(root, "src/*")]);
  });

  it("adds nothing when no exports target lies in the declaration output", () => {
    const root = selfReferencing({ ".": { types: "./index.d.ts" } });
    expect(
      selfReferenceOptions(
        root,
        join(root, "dist"),
        join(root, "src"),
        join(root, "tsconfig.json"),
      ),
    ).toEqual({});
  });
});
