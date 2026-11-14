import { describe, expect, it } from "vitest";

import { importsUnder } from "@tests/helpers/source-imports";

describe("lib/wizard layering", () => {
  it("imports nothing from the rest of the CLI, so the engine can be lifted out", async () => {
    const imports = await importsUnder("lib/wizard");

    const leaving = imports.filter((entry) => {
      return !entry.target.startsWith("lib/wizard/") && entry.target !== "lib/wizard";
    });

    expect(leaving).toEqual([]);
  });
});
