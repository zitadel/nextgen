import { describe, expect, it } from "vitest";

import { invocationChannel } from "../../../../../src/lib/telemetry/dimensions/invocation-channel";

describe("invocationChannel", () => {
  it("derives the package manager from its user-agent (pnpm wins over the npm substring)", () => {
    expect(invocationChannel.value({ npm_config_user_agent: "pnpm/10.0.0 npm/? node/v24" })).toBe(
      "pnpm",
    );
    expect(invocationChannel.value({ npm_config_user_agent: "npm/10 node/v24" })).toBe("npm");
    expect(invocationChannel.value({ npm_config_user_agent: "yarn/4 npm/? node/v24" })).toBe("yarn");
    expect(invocationChannel.value({})).toBe("unknown");
  });
});
