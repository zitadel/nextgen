import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ZitadelAuthOptions,
  ZitadelAuthResult,
  ZitadelAuthState,
  ZitadelMiddlewareOptions,
  ZitadelAuthSession,
  ZitadelUnauthState,
} from "../server";

import { auth, ZitadelProvider } from "../server";

describe("server entry", () => {
  // A Server Component imports `auth` and the types it answers with from one
  // place, as it does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(auth).returns.resolves.toEqualTypeOf<ZitadelAuthResult>();
    expectTypeOf<ZitadelAuthState["session"]>().toEqualTypeOf<ZitadelAuthSession>();
    expectTypeOf<ZitadelUnauthState["session"]>().toEqualTypeOf<null>();
    expectTypeOf<ZitadelAuthOptions["audience"]>().toEqualTypeOf<
      ZitadelMiddlewareOptions["audience"]
    >();
  });

  it("loads and exports the server helpers", () => {
    expect(auth).toBeTypeOf("function");
    expect(ZitadelProvider).toBeTypeOf("function");
  });
});
