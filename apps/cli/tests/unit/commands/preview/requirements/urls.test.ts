import { describe, expect, it } from "vitest";

import { previewUrlsFrom } from "../../../../../src/commands/preview/requirements/urls";

const NOTHING = () => ({ urls: [], variablesLookedFor: ["VERCEL_URL", "DEPLOY_URL"] });

describe("previewUrlsFrom", () => {
  it("sends a URL given twice once", () => {
    expect(previewUrlsFrom(["https://a.app", "https://a.app"], NOTHING)).toEqual(["https://a.app"]);
  });

  it("falls back to the URLs the platform names", () => {
    expect(
      previewUrlsFrom([], () => ({ urls: ["https://b.app"], variablesLookedFor: [] })),
    ).toEqual(["https://b.app"]);
  });

  it("names the variables it looked for when there are none", () => {
    expect(previewUrlsFrom([], NOTHING)).toEqual({ variables: "VERCEL_URL, DEPLOY_URL" });
  });
});
