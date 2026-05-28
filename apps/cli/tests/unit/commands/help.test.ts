import { describe, expect, it } from "vitest";

import { runHelp } from "../../../src/commands/help";
import { COMMANDS } from "../../../src/commands/registry";
import type { CliIO, GlobalOptions } from "../../../src/io/output";

type Capture = { io: CliIO; out: () => string };

function makeIO(): Capture {
  let buffer = "";
  const io: CliIO = {
    stdout: {
      write: (chunk: string | Uint8Array): boolean => {
        buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
    },
    stderr: {
      write: (): boolean => true,
    },
    env: {},
    isTTY: false,
  };
  return { io, out: () => buffer };
}

function makeOpts(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd: "/tmp",
    json: false,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "help",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

function parseEnvelope(raw: string): {
  status: string;
  data: Record<string, unknown>;
} {
  const parsed = JSON.parse(raw) as { status: string; data: Record<string, unknown> };
  return parsed;
}

describe("runHelp root index (json)", () => {
  it("emits an ok envelope listing every command from the registry", async () => {
    const { io, out } = makeIO();
    await runHelp(io, makeOpts({ json: true }));

    const envelope = parseEnvelope(out());
    expect(envelope.status).toBe("ok");
    expect(envelope.data.title).toBe("Zitadel CLI help");

    const commands = envelope.data.commands as Array<{ name: string }>;
    const emittedNames = commands.map((command) => command.name);
    expect(emittedNames).toEqual(COMMANDS.map((spec) => spec.name));
  });

  it("carries summary, usage, and agent_status for each listed command", async () => {
    const { io, out } = makeIO();
    await runHelp(io, makeOpts({ json: true }));

    const commands = parseEnvelope(out()).data.commands as Array<{
      name: string;
      summary: string;
      usage: string;
      agent_status: string;
    }>;
    const setup = commands.find((command) => command.name === "setup");
    const expected = COMMANDS.find((spec) => spec.name === "setup");
    expect(setup?.summary).toBe(expected?.summary);
    expect(setup?.usage).toBe(expected?.usage);
    expect(setup?.agent_status).toBe(expected?.agent_status);
  });
});

describe("runHelp for a specific command (json)", () => {
  it("emits the details envelope for a known command", async () => {
    const { io, out } = makeIO();
    await runHelp(io, makeOpts({ json: true }), "setup");

    const envelope = parseEnvelope(out());
    expect(envelope.status).toBe("ok");
    expect(envelope.data.title).toBe("Help: zitadel setup");

    const command = envelope.data.command as {
      name: string;
      flags: unknown[];
    };
    const expected = COMMANDS.find((spec) => spec.name === "setup");
    expect(command.name).toBe("setup");
    expect(command.flags.length).toBe(expected?.flags.length);
  });

  it("emits an unknown-command shape for an unrecognized target", async () => {
    const { io, out } = makeIO();
    await runHelp(io, makeOpts({ json: true }), "does-not-exist");

    const envelope = parseEnvelope(out());
    expect(envelope.status).toBe("ok");
    expect(envelope.data.title).toBe("unknown-command");
    expect(envelope.data.target).toBe("does-not-exist");
    expect(envelope.data.commands).toEqual(COMMANDS.map((spec) => spec.name));
  });
});

describe("runHelp pretty (non-json)", () => {
  it("writes the human root index without throwing and lists each command name", async () => {
    const { io, out } = makeIO();
    await expect(runHelp(io, makeOpts({ json: false }))).resolves.toBeUndefined();

    const text = out();
    expect(text).toContain("Usage: zitadel <command> [flags]");
    for (const spec of COMMANDS) {
      expect(text).toContain(spec.name);
    }
  });

  it("writes human command detail without throwing", async () => {
    const { io, out } = makeIO();
    await expect(runHelp(io, makeOpts({ json: false }), "setup")).resolves.toBeUndefined();

    const text = out();
    expect(text).toContain("zitadel setup");
    expect(text).toContain("Flags:");
  });

  it("writes a human unknown-command message without throwing", async () => {
    const { io, out } = makeIO();
    await expect(runHelp(io, makeOpts({ json: false }), "nope")).resolves.toBeUndefined();
    expect(out()).toContain('Unknown command "nope"');
  });
});
