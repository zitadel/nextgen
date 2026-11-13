import { describe, expect, it } from "vitest";

import {
  callsOf,
  declaredAs,
  identifiersIn,
  joinsStrings,
  keysOf,
  parsedSource,
  textsIn,
  valueOf,
} from "@tests/helpers/declarations";

/** A module declaring refusals every way one is written, and a const of another type. */
const MODULE = parsedSource(
  "module.ts",
  [
    "const TYPED: Refused<string> = { refusal: { message: 'a {x}' } };",
    "const NESTED: Refused<ReadonlyArray<string>> = { refusal: { message: 'n' } };",
    "const SATISFYING = { refusal: { message: 'b' } } as const satisfies Refused<number>;",
    "const PLAIN = { refusal: { message: 'p' } } satisfies Refused<string>;",
    "const OTHER = { message: 'c', hint: `see ${link} {x}` } as const satisfies Refusal;",
    "const JOINED = { message: 'a ' + 'b' } as const satisfies Refusal;",
    "throw refusalError(cond ? OTHER : JOINED, { x: 1, ...rest }, { fix });",
  ].join("\n"),
);

describe("declaredAs", () => {
  it("finds a declaration however its type is given", () => {
    const names = declaredAs(MODULE, "Refused").map((declaration) => {
      return declaration.name;
    });

    expect(names).toEqual(["TYPED", "NESTED", "SATISFYING", "PLAIN"]);
  });

  it("tells one type from another whose name starts the same", () => {
    const names = declaredAs(MODULE, "Refusal").map((declaration) => {
      return declaration.name;
    });

    expect(names).toEqual(["OTHER", "JOINED"]);
  });
});

describe("keysOf", () => {
  it("names only the keys an object gives a value for itself", () => {
    const literal = parsedSource(
      "keys.ts",
      "x({ max, min: 1, 'sso-client-id': 2, range: pick(a, low), nested: { deep: 1 }, ...extra });",
    );
    const [call] = callsOf(literal, ["x"]);

    expect(keysOf(call?.arguments[0])).toEqual(["max", "min", "sso-client-id", "range", "nested"]);
  });
});

describe("textsIn", () => {
  it("reads each string, leaving out what a template substitutes", () => {
    const [other] = declaredAs(MODULE, "Refusal");

    expect(other === undefined ? [] : textsIn(other.literal)).toEqual(["c", "see ", " {x}"]);
  });
});

describe("joinsStrings", () => {
  it("tells wording joined with + from wording written as one literal", () => {
    const joined = declaredAs(MODULE, "Refusal").map((declaration) => {
      return joinsStrings(declaration.literal);
    });

    expect(joined).toEqual([false, true]);
  });
});

describe("callsOf", () => {
  it("finds a call by its name, with what it is given", () => {
    const [thrown] = callsOf(MODULE, ["refusalError"]);

    expect(identifiersIn(thrown?.arguments[0])).toEqual(["cond", "OTHER", "JOINED"]);
  });
});

describe("valueOf", () => {
  it("is the value an object gives a key itself", () => {
    const [typed] = declaredAs(MODULE, "Refused");

    expect(typed === undefined ? [] : keysOf(valueOf(typed.literal, "refusal"))).toEqual([
      "message",
    ]);
  });
});
