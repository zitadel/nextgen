import { describe, expect, it } from "vitest";

import {
  commandEventProperties,
  deviceProfileProperties,
  VERCEL_EVENT_KEYS,
} from "../../../../src/lib/oclif/command-telemetry";
import type { GlobalOptions } from "../../../../src/lib/oclif/types";
import { VERCEL_ENDPOINT, vercelEventBody } from "../../../../src/lib/telemetry/vercel";

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
    const props = commandEventProperties(
      meta({ source: "https://auth.internal.acme.com/x" }),
      "sess-1",
    );
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain("auth.internal.acme.com");
    expect(serialized).not.toContain("/work/app");
    expect(props.server_kind).toBe("self_hosted");
    expect(props.command).toBe("setup");
    expect(props.invocation_id).toBe("sess-1");
    expect(props.ip).toBe(0);
    expect(props.$os).toBeDefined();
    expect("mp_country_code" in props).toBe(true);
    expect("$country_code" in props).toBe(false);
  });

  it("merges per-command extras", () => {
    const props = commandEventProperties(meta(), "sess-1", { framework: "react", step: "x" });
    expect(props.framework).toBe("react");
    expect(props.step).toBe("x");
  });
});

describe("VERCEL_EVENT_KEYS", () => {
  it("gives the Vercel copy of a failed command its outcome and whether it ran without prompts", () => {
    const props = commandEventProperties(meta({ command: "doctor" }), "sess-1", {
      status: "error",
      reason: "E_NETWORK",
      exit_code: 1,
      duration_ms: 12,
    });
    const body = JSON.parse(
      vercelEventBody(
        "cli_command_failed",
        props,
        { endpoint: VERCEL_ENDPOINT, keys: VERCEL_EVENT_KEYS },
        0,
      ),
    );
    expect(Object.keys(body.ed)).toEqual([...VERCEL_EVENT_KEYS]);
    expect(body.ed).toMatchObject({
      command: "doctor",
      status: "error",
      reason: "E_NETWORK",
      non_interactive: true,
    });
    expect(body.ed).not.toHaveProperty("is_ci");
  });
});

describe("deviceProfileProperties", () => {
  it("builds an anonymous profile with no PII", () => {
    const props = deviceProfileProperties(meta(), "09233195-cd34-468c-bb7b-151554e19fbc");
    expect(String(props.$name)).toContain("09233195");
    expect(props.cli_version).toBe("0.1.0-alpha.11");
    expect("$country_code" in props).toBe(true);
    expect("mp_country_code" in props).toBe(false);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain("/work/app");
    expect(serialized).not.toContain("zitadel.cloud");
  });
});
