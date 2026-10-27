import { describe, expect, it } from "vitest";

import { componentOf, componentsIn, facetOf, kindOf, kindsIn, matches } from "./filter";
import type { Change, Release } from "./releases";

function release(
  changes: (Pick<Change, "packages" | "bump"> & Partial<Pick<Change, "markedBreaking">>)[],
): Release {
  return {
    tag: "v0.1.0",
    url: "https://github.com/zitadel/nextgen/releases/tag/v0.1.0",
    publishedAt: "2026-10-20T20:15:04Z",
    notes: "",
    changes: changes.map((change) => ({
      summary: "A change.",
      authors: [],
      markedBreaking: false,
      ...change,
    })),
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

  it("lists only the kinds the releases have, breaking first", () => {
    const releases = [
      release([{ packages: ["@zitadel/cli"], bump: "patch" }]),
      release([{ packages: ["@zitadel/cli"], bump: "minor", markedBreaking: true }]),
    ];

    expect(kindsIn(releases)).toEqual(["breaking", "patch"]);
  });
});

describe("kindOf", () => {
  it.each([
    ["major", false, "breaking"],
    ["minor", true, "breaking"],
    ["minor", false, "minor"],
    ["patch", false, "patch"],
  ] as const)("takes a %s change marked breaking: %s as %s", (bump, markedBreaking, kind) => {
    expect(kindOf({ bump, markedBreaking })).toBe(kind);
  });
});

describe("matches", () => {
  const sdkPatch = facetOf({
    packages: ["@zitadel/sdk-next", "@zitadel/sdk-nuxt"],
    bump: "patch",
    markedBreaking: false,
  });
  const cliBreaking = facetOf({
    packages: ["@zitadel/cli", "@zitadel/server"],
    bump: "minor",
    markedBreaking: true,
  });
  // The pointer to a package's left-out changes, which have every kind.
  const leftOut = { components: ["server"] };

  it("reads a change's components once each, and its kind", () => {
    expect(sdkPatch).toEqual({ components: ["sdks"], kind: "patch" });
  });

  it("shows what touches the chosen component and has the chosen kind", () => {
    const shown = (choice: Parameters<typeof matches>[1]) =>
      [sdkPatch, cliBreaking, leftOut].filter((facet) => matches(facet, choice));

    expect(shown({})).toEqual([sdkPatch, cliBreaking, leftOut]);
    expect(shown({ component: "server" })).toEqual([cliBreaking, leftOut]);
    expect(shown({ kind: "breaking" })).toEqual([cliBreaking, leftOut]);
    expect(shown({ component: "server", kind: "patch" })).toEqual([leftOut]);
    expect(shown({ component: "sdks", kind: "breaking" })).toEqual([]);
  });
});
