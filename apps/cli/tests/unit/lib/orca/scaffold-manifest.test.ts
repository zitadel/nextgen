import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { Orca } from "@/lib/orca";
import { it } from "@tests/fixtures";

describe("Orca.scaffoldHash", () => {
  it("hashes the raw text, so the same bytes give the same hash", () => {
    expect(Orca.scaffoldHash("a\n")).toBe(Orca.scaffoldHash("a\n"));
    expect(Orca.scaffoldHash("a\n")).not.toBe(Orca.scaffoldHash("a"));
  });
});

describe("Orca.readManifest", () => {
  it("is undefined when the project has no state", async ({ dir }) => {
    expect(await Orca.readManifest(dir)).toBeUndefined();
  });

  it("reads the files setup recorded", async ({ dir }) => {
    await mkdir(join(dir, ".zitadel"), { recursive: true });
    await writeFile(
      join(dir, ".zitadel/state.json"),
      JSON.stringify({
        scaffold: { files: { "app/page.tsx": { hash: "abc", class: "presentation" } } },
      }),
    );

    expect((await Orca.readManifest(dir))?.files).toEqual({
      "app/page.tsx": { hash: "abc", class: "presentation" },
    });
  });

  const MALFORMED = [
    ["an array of files", { scaffold: { files: [] } }],
    ["an entry without a hash", { scaffold: { files: { a: { class: "presentation" } } } }],
    ["an unknown class", { scaffold: { files: { a: { hash: "x", class: "other" } } } }],
    ["an unknown posture", { scaffold: { files: {}, posture: "frame" } }],
    ["a state file that holds a list", []],
    ["a state file that holds null", null],
  ] as const;

  for (const [what, state] of MALFORMED) {
    it(`degrades to undefined for ${what}`, async ({ dir }) => {
      await mkdir(join(dir, ".zitadel"), { recursive: true });
      await writeFile(join(dir, ".zitadel/state.json"), JSON.stringify(state));

      expect(await Orca.readManifest(dir)).toBeUndefined();
    });
  }
});
