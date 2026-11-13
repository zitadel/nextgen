import { describe, expect, it } from "vitest";

import { codeOf, declaredAs, keysOf, objectAt } from "@tests/helpers/declarations";

/** A module declaring refusals every way one is written, and a const of another type. */
const MODULE = [
  "const TYPED: Refused<string> = { refusal: { message: 'a {x}' } };",
  "const NESTED: Refused<ReadonlyArray<string>> = { refusal: { message: 'n' } };",
  "const SATISFYING = {",
  "  refusal: { message: 'b' },",
  "} as const satisfies Refused<number>;",
  "const PLAIN = { refusal: { message: 'p' } } satisfies Refused<string>;",
  "const WRAPPED = {",
  "  refusal: { message: 'w' },",
  "}",
  "  satisfies Refused<string>;",
  "const OTHER = { message: 'c' } as const satisfies Refusal;",
].join("\n");

describe("declaredAs", () => {
  it("finds a declaration however its type is given", () => {
    const names = declaredAs(MODULE, "Refused").map((declaration) => {
      return declaration.name;
    });

    expect(names).toEqual(["TYPED", "NESTED", "SATISFYING", "PLAIN", "WRAPPED"]);
  });

  it("tells one type from another whose name starts the same", () => {
    const names = declaredAs(MODULE, "Refusal").map((declaration) => {
      return declaration.name;
    });

    expect(names).toEqual(["OTHER"]);
  });
});

describe("objectAt", () => {
  it("does not end an object at a brace inside a string or a comment", () => {
    const source = "x = { hint: 'Pass \\'}\\' here', /* } */ next: [] } as const;";

    expect(objectAt(source, source.indexOf("{"))).toBe(
      "{ hint: 'Pass \\'}\\' here', /* } */ next: [] }",
    );
  });

  it("does not end an object at a brace or a quote inside a regex literal", () => {
    const source = "x = { schema: z.string().regex(/^[}\"']+\\/\\//), max: 3 };";

    expect(objectAt(source, source.indexOf("{"))).toBe(
      "{ schema: z.string().regex(/^[}\"']+\\/\\//), max: 3 }",
    );
  });
});

describe("keysOf", () => {
  it("names only the keys the object gives a value for itself", () => {
    const literal = "{ max, min: 1, range: pick(a, low, b), nested: { deep: 1 }, ...extra }";

    expect(keysOf(literal)).toEqual(["max", "min", "range", "nested"]);
  });

  it("reads a quoted key, and one a comment sits above", () => {
    const literal = '{\n  // why\n  value: 1,\n  "sso-client-id": 2 }';

    expect(keysOf(literal)).toEqual(["value", "sso-client-id"]);
  });
});

describe("codeOf", () => {
  it("takes out a comment that holds a backtick without reading it as a template", () => {
    const source = "// a lone ` here\nreads(PORT); `x` + 'y' // https://z";

    expect(codeOf(source)).toBe(' \nreads(PORT); "" + ""  ');
  });
});
