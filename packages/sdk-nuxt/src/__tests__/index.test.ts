import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import { describe, expect, it } from "vitest";

import { businessLocales } from "../index";

describe("package entry", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});
