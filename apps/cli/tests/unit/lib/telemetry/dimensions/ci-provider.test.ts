import { describe, expect, it } from "vitest";

import { ciProvider, runsInCi } from "@/lib/telemetry/dimensions/ci-provider";

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

describe("runsInCi", () => {
  it.each([{ CI: "true" }, { CF_PAGES: "1" }, { TF_BUILD: "True" }, { CODEBUILD_BUILD_ID: "1" }])(
    "recognises %j",
    (env) => {
      expect(runsInCi(env)).toBe(true);
    },
  );

  it("is false on a machine with none of them", () => {
    expect(runsInCi({})).toBe(false);
  });
});
