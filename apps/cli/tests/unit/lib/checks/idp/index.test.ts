import { describe, expect, it } from "vitest";

import { IDP_CHECKS, PROVIDER_PROBES } from "../../../../../src/lib/checks/idp";

describe("PROVIDER_PROBES", () => {
  it("knows Google's wording", () => {
    expect([...PROVIDER_PROBES.keys()]).toEqual(["google"]);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "finds nothing for a slug that is a name every object inherits: %s",
    (slug) => {
      expect(PROVIDER_PROBES.get(slug)).toBeUndefined();
    },
  );
});

describe("IDP_CHECKS", () => {
  it("is the six checks that need no browser", () => {
    expect(IDP_CHECKS.map((check) => check.name)).toEqual([
      "discovery",
      "issuer",
      "scopes",
      "claims",
      "pkce",
      "callback-uri",
    ]);
  });

  it("gives every check its own name, since dependencies are named", () => {
    expect(new Set(IDP_CHECKS.map((check) => check.name)).size).toBe(IDP_CHECKS.length);
  });
});
