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

  it("uses the after-hash token verbatim, without case changes", () => {
    expect(hookName("x-auth-methods#magicLink")).toBe("magicLink");
  });

  it("returns names with a trailing hash unchanged", () => {
    expect(hookName("broken#")).toBe("broken#");
  });

  it("takes the last hash segment when several appear", () => {
    expect(hookName("a#b#c")).toBe("c");
  });
});
