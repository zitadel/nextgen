import { describe, expect, it } from "vitest";

import { hostAgent } from "../../../../../src/lib/telemetry/dimensions/host-agent";

describe("hostAgent", () => {
  it("identifies the driving agent from a fixed enum", () => {
    expect(hostAgent.value({ CLAUDECODE: "1" })).toBe("claude_code");
    expect(hostAgent.value({ CURSOR_TRACE_ID: "x" })).toBe("cursor");
    expect(hostAgent.value({ TERM_PROGRAM: "vscode" })).toBe("vscode");
    expect(hostAgent.value({})).toBe("unknown");
  });
});
