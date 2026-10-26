import { describe, expect, it } from "vitest";

import { customizeAndPublishActions } from "../../../src/lib/journey-guidance";
import { environmentSelectorSuffix } from "../../../src/lib/oclif/environment-flags";

describe("customizeAndPublishActions", () => {
  it("quotes the publish commands with the run's environment", () => {
    const actions = customizeAndPublishActions(
      "1.0.0-alpha.25",
      environmentSelectorSuffix({ envName: "production" }),
    );

    expect(actions.join("\n")).toContain("--env production");
  });

  it("adds no selector for the default environment", () => {
    const actions = customizeAndPublishActions("1.0.0-alpha.25", environmentSelectorSuffix({}));

    expect(actions.join("\n")).not.toContain("--env");
  });
});
