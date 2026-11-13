import { describe, expect, it } from "vitest";

import { declaredAs, objectAt } from "@tests/helpers/declarations";

/** A module declaring one refusal each way, and a const of another type. */
const MODULE = [
  "const TYPED: Refused<string> = { refusal: { message: 'a {x}' } };",
  "const SATISFYING = {",
  "  refusal: { message: 'b' },",
  "} as const satisfies Refused<number>;",
  "const OTHER = { message: 'c' } as const satisfies Refusal;",
].join("\n");

describe("declaredAs", () => {
  it("finds a declaration typed with an annotation or by satisfies", () => {
    const names = declaredAs(MODULE, "Refused").map((declaration) => {
      return declaration.name;
    });

    expect(names).toEqual(["TYPED", "SATISFYING"]);
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
});
