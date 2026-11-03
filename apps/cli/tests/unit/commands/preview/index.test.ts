import { describe, expect, it } from "vitest";

import { readPreviewUrls, refusePrimaryOrigins } from "../../../../src/commands/preview/index";

function clientWith(primaries: readonly string[]) {
  return {
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
  } as never;
}

describe("the preview URLs a run deploys to", () => {
  it("sends a URL given twice once", () => {
    expect(readPreviewUrls(["https://a.app", "https://a.app"], {})).toEqual(["https://a.app"]);
  });

  it("falls back to the URL the platform's own build names", () => {
    expect(readPreviewUrls([], { VERCEL_URL: "b.app" })).toEqual(["https://b.app"]);
  });

  it("names the variables it looked for when there are none", () => {
    expect(() => {
      readPreviewUrls([], {});
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "No preview URLs to deploy to",
        hint: expect.stringContaining("VERCEL_URL"),
      }),
    );
  });
});

describe("the preview URLs, checked against the project's primary origins", () => {
  it("passes URLs that are no primary origin", async () => {
    await expect(
      refusePrimaryOrigins(["https://pr-1.a.app"], clientWith(["https://a.app"]), "prj_1"),
    ).resolves.toBeUndefined();
  });

  it("refuses a URL that is a primary origin, naming it", async () => {
    await expect(
      refusePrimaryOrigins(
        ["https://a.app", "https://pr-1.a.app"],
        clientWith(["https://a.app"]),
        "prj_1",
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "https://a.app is a primary origin",
    });
  });

  it("passes them when the project has no primary origin to compare against", async () => {
    await expect(
      refusePrimaryOrigins(["https://a.app"], clientWith([]), "prj_1"),
    ).resolves.toBeUndefined();
  });
});
