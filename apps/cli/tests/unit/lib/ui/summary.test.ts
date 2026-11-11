import { describe, expect, it } from "vitest";

import { section } from "@/lib/ui/summary";

describe("section", () => {
  it("keeps its facts in the order they were given", () => {
    expect(section("Project", ["Id", "proj-1"], ["Server", "api"]).facts).toEqual([
      ["Id", "proj-1"],
      ["Server", "api"],
    ]);
  });

  it("has no heading when none was given", () => {
    expect(section(undefined, ["Id", "proj-1"])).not.toHaveProperty("heading");
  });
});
