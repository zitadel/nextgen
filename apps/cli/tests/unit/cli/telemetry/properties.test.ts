import type { Properties } from "mixpanel";
import { describe, expect, it } from "vitest";

import {
  commandEventProperties,
  deviceProfileProperties,
  firstSeenProperties,
  serverKindOf,
  vercelEventKeys,
} from "@/cli/telemetry/properties";
import type { GlobalOptions } from "@/lib/oclif/types";
import { VERCEL_ENDPOINT, vercelEventBody } from "@/lib/telemetry/vercel";

function meta(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd: "/work/app",
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "setup",
    cliVersion: "0.1.0-alpha.11",
    source: "https://preview.zitadel.com",
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
      "self_hosted",
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
    const props = commandEventProperties(meta(), "self_hosted", "sess-1", {
      framework: "react",
      step: "x",
    });
    expect(props.framework).toBe("react");
    expect(props.step).toBe("x");
  });
});

describe("vercelEventKeys", () => {
  function vercelCopy(event: string, command: string, extra: Properties, headline?: string) {
    const props = commandEventProperties(meta({ command }), "self_hosted", "sess-1", extra);
    return JSON.parse(
      vercelEventBody(
        event,
        props,
        { endpoint: VERCEL_ENDPOINT, keys: vercelEventKeys(headline) },
        0,
      ),
    ).ed as Record<string, unknown>;
  }

  it("gives the Vercel copy of a failed command the header, its outcome and whether it ran without prompts", () => {
    const copy = vercelCopy("cli_command_failed", "variable:list", {
      status: "error",
      reason: "E_NETWORK",
      exit_code: 1,
      duration_ms: 12,
    });
    expect(Object.keys(copy)).toEqual([...vercelEventKeys()]);
    expect(copy).toMatchObject({
      surface: "cli",
      command: "variable:list",
      status: "error",
      reason: "E_NETWORK",
      non_interactive: true,
    });
    expect(copy).not.toHaveProperty("is_ci");
  });

  it("keeps a completed command's own dimension beside whether it ran without prompts", () => {
    const copy = vercelCopy(
      "cli_command_completed",
      "setup",
      { framework: "nextjs", renderer: "react", status: "ok" },
      "framework",
    );
    expect(copy).toMatchObject({ framework: "nextjs", non_interactive: true });
    expect(copy).not.toHaveProperty("renderer");
  });

  it("puts a failed command's own dimension in place of whether it ran without prompts", () => {
    const copy = vercelCopy(
      "cli_command_failed",
      "doctor",
      { checks_failed: 1, failed_checks: "port", status: "error", reason: "E_PORT_IN_USE" },
      "failed_checks",
    );
    expect(copy).toMatchObject({ failed_checks: "port", reason: "E_PORT_IN_USE" });
    expect(copy).not.toHaveProperty("non_interactive");
    expect(copy).not.toHaveProperty("checks_failed");
  });

  it("keeps whether a failed command ran without prompts when it recorded no dimension of its own", () => {
    const copy = vercelCopy("cli_command_failed", "doctor", {
      status: "error",
      reason: "E_NETWORK",
    });
    expect(copy).toMatchObject({ non_interactive: true });
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
    expect(serialized).not.toContain("zitadel.com");
  });
});

describe("the run's environment", () => {
  it("says whether the run counts as customer traffic and where the CLI ran from", () => {
    const props = commandEventProperties(
      meta({ env: { ZITADEL_TELEMETRY_ENV: "production" } }),
      "cloud",
      "sess-1",
    );

    expect(props.environment).toBe("production");
    expect(["package", "source"]).toContain(props.install_source);
  });

  it("says a run inside a coding agent is one, and any other run is not", () => {
    const inside = commandEventProperties(meta({ env: { CLAUDECODE: "1" } }), "cloud", "sess-1");
    const outside = commandEventProperties(meta({ env: {} }), "cloud", "sess-1");

    expect({ host: inside.host_agent, is_agent: inside.is_agent }).toEqual({
      host: "claude_code",
      is_agent: true,
    });
    expect(outside.is_agent).toBe(false);
  });
});

describe("serverKindOf", () => {
  it("is none for a command that names no server, and the kind of any other", () => {
    expect(serverKindOf("")).toBe("none");
    expect(serverKindOf("http://localhost:8080")).toBe("local");
    expect(serverKindOf("not a url")).toBe("unknown");
  });
});

describe("the install's profile", () => {
  it("carries how the CLI was launched and whether it ran in an agent, beside its versions", () => {
    const props = deviceProfileProperties(meta({ env: { CLAUDECODE: "1" } }), "09233195-cd34");

    expect(props).toMatchObject({
      cli_version: "0.1.0-alpha.11",
      host_agent: "claude_code",
      is_agent: true,
    });
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["node_version", "invocation_channel", "install_source"]),
    );
  });

  it("names the version an install began on, to be written once", () => {
    expect(firstSeenProperties("0.1.0-alpha.11")).toEqual({ first_cli_version: "0.1.0-alpha.11" });
  });
});
