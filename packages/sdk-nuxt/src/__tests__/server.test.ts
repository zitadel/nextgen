import { describe, expectTypeOf, it } from "vitest";

import type {
  AuthResult,
  AuthState,
  ClientAuthResult,
  NextgenSession,
  UnauthReason,
  UnauthState,
} from "../server";

import { getAuth, getClientAuth } from "../server";

describe("server entry", () => {
  // A server route imports its helpers and their types from one place, as it
  // does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(getAuth).returns.toEqualTypeOf<AuthResult>();
    expectTypeOf(getClientAuth).returns.toEqualTypeOf<ClientAuthResult>();
    expectTypeOf<AuthState["session"]>().toEqualTypeOf<NextgenSession>();
    expectTypeOf<UnauthState["reason"]>().toEqualTypeOf<UnauthReason | undefined>();
  });
});
