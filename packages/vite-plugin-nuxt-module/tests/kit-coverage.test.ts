import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as kit from "@nuxt/kit";
import { describe, expect, it } from "vitest";

import { FIXTURES } from "./contract/paths.ts";
import { KIT_API } from "./contract/kit-api.ts";

/** The names the fixture module imports from `@nuxt/kit`. */
function importedFromKit(): string[] {
  const source = readFileSync(join(FIXTURES, "module/src/module.ts"), "utf8");
  const names = /import\s*\{([^}]*)\}\s*from\s*"@nuxt\/kit"/.exec(source)?.[1] ?? "";
  return names
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

describe("the @nuxt/kit API the contract covers", () => {
  it("decides every export of the installed @nuxt/kit", () => {
    expect(Object.keys(KIT_API).sort()).toEqual(Object.keys(kit).sort());
  });

  it("covers exactly the exports the fixture module imports", () => {
    const covered = Object.entries(KIT_API)
      .filter(([, coverage]) => coverage === "covered")
      .map(([name]) => name)
      .sort();
    expect(importedFromKit()).toEqual(covered);
  });

  it.each(Object.entries(KIT_API).filter(([, coverage]) => coverage !== "covered"))(
    "excludes %s with a reason",
    (_name, coverage) => {
      expect(coverage).toEqual({ excluded: expect.stringMatching(/\S{3,}/) });
    },
  );
});
