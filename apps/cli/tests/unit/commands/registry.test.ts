import { describe, expect, it } from "vitest";

import { COMMANDS, findCommandSpec } from "../../../src/commands/registry";

describe("COMMANDS", () => {
  it("is a non-empty array of command specs", () => {
    expect(Array.isArray(COMMANDS)).toBe(true);
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  it("gives every spec the required documentation fields", () => {
    const validStatuses = ["supported", "supported-mock-default", "experimental"];
    for (const spec of COMMANDS) {
      expect(typeof spec.name).toBe("string");
      expect(spec.name.length).toBeGreaterThan(0);
      expect(typeof spec.summary).toBe("string");
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(typeof spec.usage).toBe("string");
      expect(spec.usage.length).toBeGreaterThan(0);
      expect(validStatuses).toContain(spec.agent_status);
      expect(Array.isArray(spec.flags)).toBe(true);
      expect(spec.flags.length).toBeGreaterThan(0);
      for (const flag of spec.flags) {
        expect(typeof flag.name).toBe("string");
        expect(flag.name.length).toBeGreaterThan(0);
        expect(["string", "boolean", "string[]"]).toContain(flag.type);
        expect(typeof flag.description).toBe("string");
      }
    }
  });

  it("uses unique command names", () => {
    const names = COMMANDS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the known golden-path commands", () => {
    const names = COMMANDS.map((spec) => spec.name);
    expect(names).toContain("setup");
    expect(names).toContain("apply");
    expect(names).toContain("deploy status");
  });
});

describe("findCommandSpec", () => {
  it("returns the matching spec for a known name", () => {
    const spec = findCommandSpec("setup");
    expect(spec).toBeDefined();
    expect(spec?.name).toBe("setup");
  });

  it("matches multi-word command names exactly", () => {
    const spec = findCommandSpec("deploy status");
    expect(spec?.name).toBe("deploy status");
  });

  it("returns undefined for an unknown name", () => {
    expect(findCommandSpec("nope-not-a-command")).toBeUndefined();
  });

  it("returns the same reference held in COMMANDS", () => {
    const spec = findCommandSpec("apply");
    expect(spec).toBe(COMMANDS.find((command) => command.name === "apply"));
  });
});
