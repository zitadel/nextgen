import { describe, expect, it } from "vitest";

import { customizeAndPublishActions } from "@/lib/journey-guidance";
import { aSuggest } from "@tests/helpers/suggestions";

describe("customizeAndPublishActions", () => {
  it("quotes the publish commands with the run's environment", () => {
    const actions = customizeAndPublishActions(aSuggest({ env: "production" }));

    expect(actions.join("\n")).toContain("deploy --dry-run --env production");
    expect(actions.join("\n")).toContain("deploy --message '<what changed>' --env production");
  });

  it("adds no selector for the default environment", () => {
    const actions = customizeAndPublishActions(aSuggest());

    expect(actions.join("\n")).not.toContain("--env");
  });
});
