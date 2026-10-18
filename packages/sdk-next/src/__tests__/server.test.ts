import { describe, expectTypeOf, it } from "vitest";

import type { AuthResult, AuthState, NextgenSession, UnauthState } from "../server";

import { auth } from "../server";

describe("server entry", () => {
  // A Server Component imports `auth` and the types it answers with from one
  // place, as it does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(auth).returns.resolves.toEqualTypeOf<AuthResult>();
    expectTypeOf<AuthState["session"]>().toEqualTypeOf<NextgenSession>();
    expectTypeOf<UnauthState["session"]>().toEqualTypeOf<null>();
  });
});
