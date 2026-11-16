import { describe, expect, it } from "vitest";

import { Runtime, type UserAgentFacts } from "@/lib/runtime";

const FACTS: UserAgentFacts = {
  cliVersion: "1.2.3-alpha.4",
  nodeVersion: "v24.12.0",
  platform: "darwin",
  osRelease: "24.6.0",
  arch: "arm64",
};

describe("Runtime.buildUserAgent", () => {
  it("names the CLI, runtime, OS and architecture", () => {
    expect(Runtime.buildUserAgent(FACTS)).toBe(
      "zitadel-cli/1.2.3-alpha.4 node/v24.12.0 darwin/24.6.0 arch/arm64",
    );
  });

  it("replaces characters a token cannot hold, so a token never splits in two", () => {
    expect(Runtime.buildUserAgent({ ...FACTS, osRelease: "6.1 (custom/build)" })).toContain(
      "darwin/6.1__custom_build_",
    );
  });

  it("falls back to unknown for an empty value", () => {
    expect(Runtime.buildUserAgent({ ...FACTS, cliVersion: "" })).toMatch(/^zitadel-cli\/unknown /);
  });
});

describe("Runtime.userAgentFor", () => {
  it("describes the running process", () => {
    const agent = Runtime.userAgentFor("9.9.9");

    expect(agent.startsWith(`zitadel-cli/9.9.9 node/${process.version} `)).toBe(true);
    expect(agent.endsWith(` arch/${process.arch}`)).toBe(true);
  });
});

describe("Runtime.useUserAgent", () => {
  it("answers the one the run was given", () => {
    Runtime.current().useUserAgent("zitadel-cli/1.0.0");

    expect(Runtime.current().userAgent()).toBe("zitadel-cli/1.0.0");
  });
});

describe("Runtime.isDevelopment", () => {
  it.each([
    ["1", true],
    ["true", true],
    [" TRUE ", true],
    ["yes", true],
    ["", false],
    ["0", false],
    ["false", false],
    ["FALSE", false],
  ])("reads ZITADEL_CLI_DEV=%j as %s", (value, expected) => {
    expect(Runtime.current().isDevelopment({ ZITADEL_CLI_DEV: value })).toBe(expected);
  });

  it("reads an unset flag as a normal run", () => {
    expect(Runtime.current().isDevelopment({})).toBe(false);
  });
});
