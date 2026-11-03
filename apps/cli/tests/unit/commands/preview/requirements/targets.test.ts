import { describe, expect, it } from "vitest";

import { productionUrls } from "../../../../../src/commands/preview/requirements/targets";

describe("productionUrls", () => {
  it("is the URLs that are primary origins", () => {
    expect(productionUrls(["https://a.app", "https://pr-1.a.app"], ["https://a.app"])).toEqual([
      "https://a.app",
    ]);
  });

  it("is none when the project's origins could not be read", () => {
    expect(productionUrls(["https://a.app"], [])).toEqual([]);
  });
});
