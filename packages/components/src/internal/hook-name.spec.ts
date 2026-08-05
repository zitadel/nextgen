import { describe, expect, it } from "vitest";

import { hookName } from "./hook-name.js";

describe("hookName", () => {
  it("strips the auth-method credential prefix", () => {
    expect(hookName("x-auth-methods#password")).toBe("password");
  });

  it("keeps plain field names unchanged", () => {
    expect(hookName("email")).toBe("email");
    expect(hookName("givenName")).toBe("givenName");
  });

  it("uses the after-prefix token verbatim, without case changes", () => {
    expect(hookName("x-auth-methods#magicLink")).toBe("magicLink");
  });

  it("keeps hashes in tenant-authored property names", () => {
    // Only the reserved prefix is dialect; any other `#` is part of the
    // (arbitrary, tenant-authored) property name.
    expect(hookName("a#b#c")).toBe("a#b#c");
    expect(hookName("room#number")).toBe("room#number");
  });

  it("returns a bare or degenerate prefix unchanged", () => {
    expect(hookName("x-auth-methods#")).toBe("x-auth-methods#");
    expect(hookName("x-auth-methods")).toBe("x-auth-methods");
  });

  it("strips only the leading prefix, keeping later hashes", () => {
    expect(hookName("x-auth-methods#weird#method")).toBe("weird#method");
  });
});
