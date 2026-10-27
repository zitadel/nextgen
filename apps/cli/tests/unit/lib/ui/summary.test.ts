import { describe, expect, it } from "vitest";

import { outcome, section } from "../../../../src/lib/ui/summary";

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

describe("outcome", () => {
  it("carries the payload and the summary together", () => {
    const result = outcome({ id: "proj-1" }, { title: "Done", sections: [] });

    expect(result).toEqual({ data: { id: "proj-1" }, summary: { title: "Done", sections: [] } });
  });
});
