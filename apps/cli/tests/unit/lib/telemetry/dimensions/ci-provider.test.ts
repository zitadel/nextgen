import { describe, expect, it } from "vitest";

import { ciProvider } from "../../../../../src/lib/telemetry/dimensions/ci-provider";

describe("ciProvider", () => {
  it("names the provider, falling back to unknown inside an unrecognized CI", () => {
    expect(ciProvider.value({ GITHUB_ACTIONS: "true" })).toBe("github_actions");
    expect(ciProvider.value({ GITLAB_CI: "true" })).toBe("gitlab_ci");
    expect(ciProvider.value({ CI: "1" })).toBe("unknown");
    expect(ciProvider.value({})).toBeUndefined();
  });

  it("ignores a present-but-false provider flag", () => {
    expect(ciProvider.value({ GITHUB_ACTIONS: "false" })).toBeUndefined();
    expect(ciProvider.value({ GITHUB_ACTIONS: "false", CI: "true" })).toBe("unknown");
  });
});
