import { describe, expect, it } from "vitest";

import {
  commandEventProperties,
  deviceProfileProperties,
} from "../../../../src/lib/oclif/command-telemetry";
import type { GlobalOptions } from "../../../../src/lib/oclif/types";

function meta(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd: "/work/app",
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "setup",
    cliVersion: "0.1.0-alpha.11",
    source: "https://api.zitadel.cloud",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
    ...overrides,
  };
}

describe("commandEventProperties", () => {
  it("emits allow-listed dimensions and never the raw source/cwd", () => {
    const props = commandEventProperties(meta({ source: "https://auth.internal.acme.com/x" }), "sess-1");
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain("auth.internal.acme.com");
    expect(serialized).not.toContain("/work/app");
    expect(props.server_kind).toBe("self_hosted");
    expect(props.command).toBe("setup");
    expect(props.session_id).toBe("sess-1");
    expect(props.ip).toBe(0);
    expect(props.$os).toBeDefined();
    expect("$country_code" in props).toBe(true);
  });

  it("merges per-command extras", () => {
    const props = commandEventProperties(meta(), "sess-1", { framework: "react", step: "x" });
    expect(props.framework).toBe("react");
    expect(props.step).toBe("x");
  });
});

describe("deviceProfileProperties", () => {
  it("builds an anonymous profile with no PII", () => {
    const props = deviceProfileProperties(meta(), "09233195-cd34-468c-bb7b-151554e19fbc");
    expect(String(props.$name)).toContain("09233195");
    expect(props.cli_version).toBe("0.1.0-alpha.11");
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain("/work/app");
    expect(serialized).not.toContain("zitadel.cloud");
  });
});
