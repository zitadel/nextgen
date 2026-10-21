import { describe, expect, it } from "vitest";

import { bumpsIn, componentOf, componentsIn, facetOf, matches } from "./filter";
import type { Change, Release } from "./releases";

function release(changes: Pick<Change, "packages" | "bump">[]): Release {
  return {
    tag: "v1.0.0-alpha.28",
    url: "https://github.com/zitadel/nextgen/releases/tag/v1.0.0-alpha.28",
    publishedAt: "2026-10-20T20:15:04Z",
    notes: "",
    changes: changes.map((change) => ({ summary: "A change.", authors: [], ...change })),
    notices: [],
  };
}

describe("components", () => {
  it("names a package as its description does, and every SDK as one component", () => {
    expect(
      [
        "@zitadel/cli",
        "@zitadel/server",
        "@zitadel/api",
        "@zitadel/config",
        "@zitadel/components",
        "@zitadel/sdk-next",
        "@zitadel/testing",
        "@zitadel/new-package",
      ].map(componentOf),
    ).toEqual([
      { id: "cli", label: "CLI" },
      { id: "server", label: "Server" },
      { id: "api", label: "API client" },
      { id: "config", label: "Config" },
      { id: "components", label: "Web components" },
      { id: "sdks", label: "SDKs" },
      { id: "testing", label: "Test kit" },
      { id: "new-package", label: "new-package" },
    ]);
  });

  it("lists the releases' components in the release notes' order of packages, a new one last", () => {
    const releases = [
      release([{ packages: ["@zitadel/sdk-next", "@zitadel/new-package"], bump: "patch" }]),
      release([{ packages: ["@zitadel/server", "@zitadel/cli"], bump: "minor" }]),
    ];

    expect(componentsIn(releases).map(({ id }) => id)).toEqual([
      "cli",
      "server",
      "sdks",
      "new-package",
    ]);
  });

  it("lists only the bumps the releases have, the highest first", () => {
    const releases = [
      release([{ packages: ["@zitadel/cli"], bump: "patch" }]),
      release([{ packages: ["@zitadel/cli"], bump: "major" }]),
    ];

    expect(bumpsIn(releases)).toEqual(["major", "patch"]);
  });
});

describe("matches", () => {
  const sdkPatch = facetOf({ packages: ["@zitadel/sdk-next", "@zitadel/sdk-nuxt"], bump: "patch" });
  const cliMinor = facetOf({ packages: ["@zitadel/cli", "@zitadel/server"], bump: "minor" });
  // The pointer to a package's left-out changes, which have every bump.
  const leftOut = { components: ["server"] };

  it("reads a change's components once each, and its bump", () => {
    expect(sdkPatch).toEqual({ components: ["sdks"], bump: "patch" });
  });

  it("shows what touches the chosen component and has the chosen bump", () => {
    const shown = (choice: Parameters<typeof matches>[1]) =>
      [sdkPatch, cliMinor, leftOut].filter((facet) => matches(facet, choice));

    expect(shown({})).toEqual([sdkPatch, cliMinor, leftOut]);
    expect(shown({ component: "server" })).toEqual([cliMinor, leftOut]);
    expect(shown({ bump: "patch" })).toEqual([sdkPatch, leftOut]);
    expect(shown({ component: "server", bump: "patch" })).toEqual([leftOut]);
    expect(shown({ component: "sdks", bump: "minor" })).toEqual([]);
  });
});
