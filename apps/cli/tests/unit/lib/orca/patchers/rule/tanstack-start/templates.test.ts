import { describe, expect, it } from "vitest";

import { profileRouteTemplate } from "../../../../../../../src/lib/orca/patchers/rule/tanstack-start/templates";

/** The handler the profile route's server function runs, whose return value reaches the browser. */
function serverFunctionHandler(): string | undefined {
  return profileRouteTemplate().match(/createServerFn\(\)\.handler\((.*)\);/)?.[1];
}

describe("profileRouteTemplate", () => {
  it("returns the client-safe auth state from its server function", () => {
    expect(serverFunctionHandler()).toBe("({ context }) => getClientAuth(context)");
  });

  it("never returns the token-bearing auth from its server function", () => {
    expect(serverFunctionHandler()).not.toMatch(/getAuth\(|token/);
  });

  it("imports nothing that carries the session token", () => {
    expect(profileRouteTemplate()).not.toMatch(/\bgetAuth\b/);
  });
});
