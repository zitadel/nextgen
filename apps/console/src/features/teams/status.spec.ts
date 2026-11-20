import { describe, expect, it } from "vitest";

import { teamStatusLabel } from "./status";

describe("teamStatusLabel", () => {
  it("names each state the API defines", () => {
    expect(teamStatusLabel("active")).toBe("Active");
    expect(teamStatusLabel("deactivated")).toBe("Inactive");
  });

  it("leaves a state it does not know, or none, to the badge", () => {
    expect(teamStatusLabel("archived")).toBeUndefined();
    expect(teamStatusLabel(undefined)).toBeUndefined();
  });
});
