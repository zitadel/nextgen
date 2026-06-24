import { describe, expect, it } from "vitest";

import {
  ciFlag,
  ciProvider,
  hostAgent,
  invocationChannel,
} from "../../../../src/lib/telemetry/env";

describe("ciFlag", () => {
  it("detects an automated CI environment", () => {
    expect(ciFlag.value({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(ciFlag.value({})).toBe(false);
  });
});

describe("ciProvider", () => {
  it("names the provider, falling back to unknown inside an unrecognized CI", () => {
    expect(ciProvider.value({ GITHUB_ACTIONS: "true" })).toBe("github_actions");
    expect(ciProvider.value({ CI: "1" })).toBe("unknown");
    expect(ciProvider.value({})).toBeUndefined();
  });
});

describe("hostAgent", () => {
  it("identifies the driving agent from a fixed enum", () => {
    expect(hostAgent.value({ CLAUDECODE: "1" })).toBe("claude_code");
    expect(hostAgent.value({ TERM_PROGRAM: "vscode" })).toBe("vscode");
    expect(hostAgent.value({})).toBe("unknown");
  });
});

describe("invocationChannel", () => {
  it("derives the package manager from its user-agent (pnpm wins over the npm substring)", () => {
    expect(invocationChannel.value({ npm_config_user_agent: "pnpm/10.0.0 npm/? node/v24" })).toBe(
      "pnpm",
    );
    expect(invocationChannel.value({ npm_config_user_agent: "npm/10 node/v24" })).toBe("npm");
    expect(invocationChannel.value({})).toBe("unknown");
  });
});
