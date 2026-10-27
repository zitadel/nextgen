import { describe, expect, it } from "vitest";

import { componentOf, firstParagraph, groupByComponent, isBreaking } from "./changes";
import type { Change } from "./releases";

function change(packages: string[], summary = "A change."): Change {
  return { summary, bump: "patch", markedBreaking: false, packages, authors: [] };
}

describe("isBreaking", () => {
  it.each([
    ["major", false, true],
    ["minor", true, true],
    ["minor", false, false],
    ["patch", false, false],
  ] as const)("takes a %s change marked breaking: %s as breaking: %s", (bump, marked, breaking) => {
    expect(isBreaking({ bump, markedBreaking: marked })).toBe(breaking);
  });
});

describe("componentOf", () => {
  it("names a package as its description does, and every SDK as one component", () => {
    expect(
      [
        "@zitadel/cli",
        "@zitadel/components",
        "@zitadel/sdk-next",
        "@zitadel/server",
        "@zitadel/testing",
        "@zitadel/api",
        "@zitadel/config",
        "@zitadel/new-package",
      ].map(componentOf),
    ).toEqual([
      { id: "cli", label: "CLI" },
      { id: "components", label: "Web components" },
      { id: "sdks", label: "SDKs" },
      { id: "server", label: "Server and console" },
      { id: "testing", label: "Test kit" },
      { id: "api", label: "API client" },
      { id: "config", label: "Config" },
      { id: "new-package", label: "new-package" },
    ]);
  });
});

describe("groupByComponent", () => {
  const groups = (changes: Change[]) =>
    groupByComponent(changes).map(({ component, changes }) => ({
      component: component.id,
      changes: changes.map(({ summary }) => summary),
    }));

  it("lists each change once, under the first component it touches in the page's order", () => {
    expect(
      groups([
        change(["@zitadel/server", "@zitadel/api"], "An API operation."),
        change(["@zitadel/config", "@zitadel/components"], "A login step."),
        change(["@zitadel/cli", "@zitadel/sdk-next"], "A file setup writes."),
        change(["@zitadel/sdk-nuxt", "@zitadel/sdk-vue"], "Two SDKs."),
        change(["@zitadel/new-package", "@zitadel/config"], "A new package."),
        change(["@zitadel/server"], "A console screen."),
      ]),
    ).toEqual([
      { component: "cli", changes: ["A file setup writes."] },
      { component: "components", changes: ["A login step."] },
      { component: "sdks", changes: ["Two SDKs."] },
      { component: "server", changes: ["An API operation.", "A console screen."] },
      { component: "config", changes: ["A new package."] },
    ]);
  });

  it("keeps a change without a package, last", () => {
    expect(groups([change([], "Loose."), change(["@zitadel/new-package"], "New.")])).toEqual([
      { component: "new-package", changes: ["New."] },
      { component: "other", changes: ["Loose."] },
    ]);
  });
});

describe("firstParagraph", () => {
  it("ends at the first blank line", () => {
    expect(firstParagraph("Replaces the flag.\n\n**Breaking:** drop it.")).toBe(
      "Replaces the flag.",
    );
    expect(firstParagraph("One paragraph,\nwrapped.")).toBe("One paragraph,\nwrapped.");
  });

  it("keeps the whole summary when the blank line falls inside a fenced code block", () => {
    const summary = "Run:\n```sh\nzitadel start\n\nzitadel setup\n```\n\nThen deploy.";
    expect(firstParagraph(summary)).toBe(summary);
  });
});
