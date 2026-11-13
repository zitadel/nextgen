import { describe, expect, it } from "vitest";

import { UPDATE_CHECK_VARIABLE, ZITADEL_SCOPE } from "@/lib/upgrade/defaults";

describe("defaults", () => {
  it("scopes the packages with a trailing slash, so a longer scope name never matches", () => {
    expect(ZITADEL_SCOPE).toBe("@zitadel/");
  });

  it("names the variable the docs tell people to set to 0", () => {
    expect(UPDATE_CHECK_VARIABLE).toBe("ZITADEL_UPDATE_CHECK");
  });
});
