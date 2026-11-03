import { describe, expect, it } from "vitest";

import { previewTargets } from "../../../../../src/commands/preview/requirements/targets";
import { requirementContext } from "../../../../helpers/requirement-context";

function targets(urls: readonly string[], primaries: readonly string[]) {
  return previewTargets.resolve(
    requirementContext({
      resolved: {
        urls,
      },
      connect: async () => {
        return {
          projectId: "prj_1",
          client: {
            getProject: async () => {
              return {
                origins: primaries.map((pattern) => {
                  return {
                    kind: "primary",
                    pattern,
                  };
                }),
              };
            },
          },
        } as never;
      },
    }),
  );
}

describe("the preview URLs, checked against the project's primary origins", () => {
  it("hands over URLs that are no primary origin", async () => {
    await expect(targets(["https://pr-1.a.app"], ["https://a.app"])).resolves.toEqual([
      "https://pr-1.a.app",
    ]);
  });

  it("refuses a URL that is a primary origin, naming it", async () => {
    await expect(
      targets(["https://a.app", "https://pr-1.a.app"], ["https://a.app"]),
    ).resolves.toEqual({
      unmet: {
        origins: "https://a.app",
      },
    });
  });

  it("hands them over when the project's origins could not be read", async () => {
    await expect(targets(["https://a.app"], [])).resolves.toEqual(["https://a.app"]);
  });
});
