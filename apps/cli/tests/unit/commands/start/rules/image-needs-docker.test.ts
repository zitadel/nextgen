import { describe, expect, it } from "vitest";

import { imageNeedsDockerRule } from "../../../../../src/commands/start/rules/image-needs-docker";

function broken(flags: Record<string, unknown>) {
  return imageNeedsDockerRule.broken({ flags, args: {}, argv: [] });
}

describe("imageNeedsDockerRule", () => {
  it("refuses an image beside the binary runtime", () => {
    expect(broken({ runtime: "binary", image: "zitadel:latest" })).toBe(true);
  });

  it.each([
    { runtime: "docker", image: "zitadel:latest" },
    { runtime: "binary" },
    { image: "zitadel:latest" },
    {},
  ])("lets %j through", (flags) => {
    expect(broken(flags)).toBe(false);
  });

  it("says how to run an image", () => {
    expect(imageNeedsDockerRule.refusal.message).toBe("--image requires --runtime docker");
  });
});
