import { describe, expect, it } from "vitest";

import {
  buildUserAgent,
  processUserAgent,
  type UserAgentFacts,
  useUserAgent,
  userAgent,
} from "@/lib/user-agent";

const FACTS: UserAgentFacts = {
  cliVersion: "1.2.3-alpha.4",
  nodeVersion: "v24.12.0",
  platform: "darwin",
  osRelease: "24.6.0",
  arch: "arm64",
};

describe("buildUserAgent", () => {
  it("names the CLI, runtime, OS and architecture", () => {
    expect(buildUserAgent(FACTS)).toBe(
      "zitadel-cli/1.2.3-alpha.4 node/v24.12.0 darwin/24.6.0 arch/arm64",
    );
  });

  it("replaces characters a token cannot hold, so a token never splits in two", () => {
    expect(buildUserAgent({ ...FACTS, osRelease: "6.1 (custom/build)" })).toContain(
      "darwin/6.1__custom_build_",
    );
  });

  it("falls back to unknown for an empty value", () => {
    expect(buildUserAgent({ ...FACTS, cliVersion: "" })).toMatch(/^zitadel-cli\/unknown /);
  });
});

describe("processUserAgent", () => {
  it("describes the running process", () => {
    const agent = processUserAgent("9.9.9");

    expect(agent.startsWith(`zitadel-cli/9.9.9 node/${process.version} `)).toBe(true);
    expect(agent.endsWith(` arch/${process.arch}`)).toBe(true);
  });
});

describe("userAgent", () => {
  it("answers the one the run was given", () => {
    useUserAgent("zitadel-cli/1.0.0");

    expect(userAgent()).toBe("zitadel-cli/1.0.0");
  });
});
