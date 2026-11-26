import { describe, expect, expectTypeOf, it } from "vitest";

import type { getAuth } from "../middleware";
import type { ZitadelClientAuthResult, ZitadelClientSession, ZitadelAuthSession } from "../types";

type ServerAuth = ReturnType<typeof getAuth>;

/** Drops the raw token, exactly as a load function or loader does before serialising. */
function stripToken(auth: ServerAuth): ZitadelClientAuthResult {
  if (!auth.isAuthenticated) {
    return auth;
  }
  const { token: _token, ...session } = auth.session;
  return { isAuthenticated: true, session };
}

describe("ZitadelClientAuthResult", () => {
  it("is the session getAuth() returns without its token", () => {
    expectTypeOf<ZitadelClientSession>().toEqualTypeOf<Omit<ZitadelAuthSession, "token">>();
    expectTypeOf(stripToken).returns.toEqualTypeOf<ZitadelClientAuthResult>();
  });

  it("carries identifier, identifierProperty and display, not email and name", () => {
    const session: ZitadelAuthSession = {
      userId: "u1",
      identifier: "a@example.com",
      identifierProperty: "email",
      display: "A",
      token: "t",
    };
    const stripped = stripToken({ isAuthenticated: true, session });
    expect(stripped).toEqual({
      isAuthenticated: true,
      session: {
        userId: "u1",
        identifier: "a@example.com",
        identifierProperty: "email",
        display: "A",
      },
    });
  });
});
