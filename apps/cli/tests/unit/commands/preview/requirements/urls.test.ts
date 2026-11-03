import { describe, expect, it } from "vitest";

import { previewUrls } from "../../../../../src/commands/preview/requirements/urls";
import { requirementContext } from "../../../../helpers/requirement-context";

function urls(origin: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return previewUrls.resolve(
    requirementContext({
      flags: {
        origin,
      },
      meta: {
        env,
      },
    }),
  );
}

describe("the preview URLs a run deploys to", () => {
  it("sends a URL given twice once", async () => {
    await expect(urls(["https://a.app", "https://a.app"])).resolves.toEqual(["https://a.app"]);
  });

  it("falls back to the URL the platform's own build names", async () => {
    await expect(urls([], { VERCEL_URL: "b.app" })).resolves.toEqual(["https://b.app"]);
  });

  it("names the variables it looked for when there are none", async () => {
    await expect(urls([])).resolves.toMatchObject({
      unmet: {
        variables: expect.stringContaining("VERCEL_URL"),
      },
    });
  });
});
