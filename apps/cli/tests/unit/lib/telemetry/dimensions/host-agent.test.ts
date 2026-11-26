import { describe, expect, it } from "vitest";

import { hostAgent } from "@/lib/telemetry/dimensions/host-agent";

describe("hostAgent", () => {
  it("identifies the driving agent from a fixed enum", () => {
    expect(hostAgent.value({ CLAUDECODE: "1" })).toBe("claude_code");
    expect(hostAgent.value({ CURSOR_AGENT: "1" })).toBe("cursor");
    expect(hostAgent.value({ CODEX_CI: "1" })).toBe("codex");
    expect(hostAgent.value({ TERM_PROGRAM: "vscode" })).toBe("vscode");
    expect(hostAgent.value({})).toBe("unknown");
  });
});
