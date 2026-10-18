import { describe, expectTypeOf, it } from "vitest";

import type { AuthResult, AuthState, NextgenSession, UnauthState } from "../index";

import { getAuth } from "../index";

describe("index entry", () => {
  // A server route imports its helpers and their types from one place, as it
  // does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(getAuth).returns.toEqualTypeOf<AuthResult>();
    expectTypeOf<AuthState["session"]>().toEqualTypeOf<NextgenSession>();
    expectTypeOf<UnauthState["session"]>().toEqualTypeOf<null>();
  });
});
