import { describe, expect, it } from "vitest";

import {
  ciProvider,
  hostAgent,
  invocationChannel,
  isCi,
} from "../../../../src/lib/telemetry/env";

describe("environment detectors", () => {
  it("detects CI and its provider", () => {
    expect(isCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCi({})).toBe(false);
    expect(ciProvider({ GITHUB_ACTIONS: "true" })).toBe("github_actions");
    expect(ciProvider({ CI: "1" })).toBe("unknown");
    expect(ciProvider({})).toBeUndefined();
  });

  it("detects the host agent from a fixed enum", () => {
    expect(hostAgent({ CLAUDECODE: "1" })).toBe("claude_code");
    expect(hostAgent({ TERM_PROGRAM: "vscode" })).toBe("vscode");
    expect(hostAgent({})).toBe("unknown");
  });

  it("derives the invocation channel from the package-manager user agent", () => {
    expect(invocationChannel({ npm_config_user_agent: "pnpm/10.0.0 npm/? node/v24" })).toBe("pnpm");
    expect(invocationChannel({ npm_config_user_agent: "npm/10 node/v24" })).toBe("npm");
    expect(invocationChannel({})).toBe("unknown");
  });
});
