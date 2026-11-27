import { describe, expect, it } from "vitest";

import { Guidance } from "@/lib/suggestion";
import { aSuggest } from "@tests/helpers/suggestions";

describe("Guidance.customizeAndPublish", () => {
  it("quotes the publish commands with the run's environment", () => {
    const actions = new Guidance(aSuggest({ env: "production" })).customizeAndPublish();

    expect(actions.join("\n")).toContain("deploy --dry-run --env production");
    expect(actions.join("\n")).toContain("deploy --message '<what changed>' --env production");
  });

  it("adds no selector for the default environment", () => {
    const actions = new Guidance(aSuggest()).customizeAndPublish();

    expect(actions.join("\n")).not.toContain("--env");
  });
});
