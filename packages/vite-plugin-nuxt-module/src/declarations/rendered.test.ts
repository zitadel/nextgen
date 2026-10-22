import { describe, expect, it } from "vitest";

import { finishedDeclaration, starReExports } from "./rendered.ts";

describe("starReExports", () => {
  it("sorts a module's package star re-exports by kind, leaving relative ones out", () => {
    expect(
      starReExports(
        'export type * from "core/types";\nexport * from "core";\nexport * from "./local";\nexport * as ns from "other";\n',
        "/pkg/src/types.ts",
      ),
    ).toEqual({ typeOnly: ["core/types"], value: ["core"] });
  });

  it("reads a declaration file and a .tsx module", () => {
    expect([
      starReExports('export type * from "a";\n', "/pkg/src/x.d.ts").typeOnly,
      starReExports('export type * from "b";\nexport const C = () => <div />;\n', "/pkg/src/x.tsx")
        .typeOnly,
    ]).toEqual([["a"], ["b"]]);
  });

  it("reads nothing from a module it cannot parse", () => {
    expect(starReExports("export type * from", "/pkg/src/x.ts")).toEqual({
      typeOnly: [],
      value: [],
    });
  });
});

describe("finishedDeclaration", () => {
  it("gives type back to a star re-export of a type-only package", () => {
    expect(
      finishedDeclaration(
        '// ü\nexport * from "core/types";\nexport * from "core";\nexport { a };\n',
        new Set(["core/types"]),
      )?.code,
    ).toBe('// ü\nexport type * from "core/types";\nexport * from "core";\nexport { a };\n');
  });

  it("makes a chunk without module syntax a module", () => {
    expect(finishedDeclaration("declare const a: number;\n", new Set())?.code).toBe(
      "declare const a: number;\n\nexport {};\n",
    );
  });

  it("leaves a finished chunk alone", () => {
    expect(finishedDeclaration("export declare const a: number;\n", new Set(["x"]))).toBeNull();
  });
});
