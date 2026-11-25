import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AuthOptions,
  AuthResult,
  AuthState,
  ZitadelMiddlewareOptions,
  ZitadelAuthSession,
  UnauthState,
} from "../server";

import { auth, ZitadelProvider } from "../server";

describe("server entry", () => {
  // A Server Component imports `auth` and the types it answers with from one
  // place, as it does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(auth).returns.resolves.toEqualTypeOf<AuthResult>();
    expectTypeOf<AuthState["session"]>().toEqualTypeOf<ZitadelAuthSession>();
    expectTypeOf<UnauthState["session"]>().toEqualTypeOf<null>();
    expectTypeOf<AuthOptions["audience"]>().toEqualTypeOf<ZitadelMiddlewareOptions["audience"]>();
  });

  it("loads and exports the server helpers", () => {
    expect(auth).toBeTypeOf("function");
    expect(ZitadelProvider).toBeTypeOf("function");
  });
});
