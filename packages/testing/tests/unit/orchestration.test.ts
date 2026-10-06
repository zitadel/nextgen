import { describe, expect, it } from "vitest";

import {
  parseAppRunnerConfig,
  parseSupervisorConfig,
  requireHandshakePath,
} from "../../src/orchestration";

describe("parseSupervisorConfig", () => {
  it("round-trips a serialized config", () => {
    const config = { port: 8092, appOrigins: ["http://localhost:3002"], keep: true };
    expect(parseSupervisorConfig(JSON.stringify(config))).toEqual(config);
  });

  it("rejects a missing env var with the var name", () => {
    expect(() => parseSupervisorConfig(undefined)).toThrow(/ZITADEL_TESTING_SUPERVISOR is not set/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseSupervisorConfig("{nope")).toThrow(/invalid JSON/);
  });

  it("rejects a config without a usable port", () => {
    expect(() => parseSupervisorConfig(JSON.stringify({ port: 0 }))).toThrow(
      /positive integer "port"/,
    );
    expect(() => parseSupervisorConfig(JSON.stringify({}))).toThrow(/positive integer "port"/);
  });
});

describe("parseAppRunnerConfig", () => {
  it("round-trips a serialized config", () => {
    const config = {
      command: ["corepack", "pnpm", "dev"],
      cwd: "/repo",
      env: { MY_URL: "baseUrl" },
      handshakeTimeoutMs: 1_000,
    };
    expect(parseAppRunnerConfig(JSON.stringify(config))).toEqual(config);
  });

  it("rejects an empty or malformed command", () => {
    expect(() => parseAppRunnerConfig(JSON.stringify({ command: [] }))).toThrow(
      /non-empty string\[\] "command"/,
    );
    expect(() => parseAppRunnerConfig(JSON.stringify({ command: ["node", ""] }))).toThrow(
      /non-empty string\[\] "command"/,
    );
  });
});

describe("requireHandshakePath", () => {
  it("returns the configured path", () => {
    expect(requireHandshakePath({ ZITADEL_TESTING_HANDSHAKE: "/tmp/h.json" })).toBe("/tmp/h.json");
  });

  it("names the env var when missing", () => {
    expect(() => requireHandshakePath({})).toThrow(/ZITADEL_TESTING_HANDSHAKE is not set/);
  });
});
