import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import {
  ok,
  skipped,
  writeError,
  writePretty,
  type CliIO,
  type ErrorEnvelope,
  type GlobalOptions,
  type OkEnvelope,
  type SkippedEnvelope,
} from "../../../src/io/output";

/**
 * A {@link CliIO} whose stdout/stderr capture every written chunk so tests can
 * assert on the exact bytes a helper produced and on which stream it used. The
 * streams are cast `as never` because the production type is the full
 * NodeJS.WriteStream surface; tests only need `.write`.
 */
type CaptureIO = CliIO & {
  out: string[];
  err: string[];
};

function makeIO(): CaptureIO {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: {
      write: (chunk: string) => {
        out.push(chunk);
        return true;
      },
    } as never,
    stderr: {
      write: (chunk: string) => {
        err.push(chunk);
        return true;
      },
    } as never,
    env: {},
    isTTY: false,
  };
}

function makeOpts(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd: "/tmp/project",
    json: false,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "apply",
    cliVersion: "1.2.3",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

describe("ok (JSON mode)", () => {
  it("writes a parseable ok envelope with meta fields and data to stdout", () => {
    const io = makeIO();
    ok(io, { project_id: "proj-1" }, makeOpts({ json: true, source: "mock" }));

    expect(io.err).toEqual([]);
    expect(io.out).toHaveLength(1);
    expect(io.out[0].endsWith("\n")).toBe(true);

    const envelope = JSON.parse(io.out[0]) as OkEnvelope<{ project_id: string }>;
    expect(envelope.status).toBe("ok");
    expect(envelope.cli_version).toBe("1.2.3");
    expect(envelope.command).toBe("apply");
    expect(envelope.source).toBe("mock");
    expect(envelope.data).toEqual({ project_id: "proj-1" });
    expect(envelope.warnings).toEqual([]);
  });

  it("includes passed warnings in the envelope", () => {
    const io = makeIO();
    ok(io, { ok: true }, makeOpts({ json: true }), ["heads up"]);

    const envelope = JSON.parse(io.out[0]) as OkEnvelope<unknown>;
    expect(envelope.warnings).toEqual(["heads up"]);
  });
});

describe("ok (pretty mode)", () => {
  it("writes a bare string payload to stdout without throwing", () => {
    const io = makeIO();
    ok(io, "Project initialized.", makeOpts({ json: false, source: "https://api.zitadel.cloud" }));

    expect(io.err).toEqual([]);
    expect(io.out).toHaveLength(1);
    expect(io.out[0]).toContain("Project initialized.");
  });

  it("appends the mock source suffix to a string payload", () => {
    const io = makeIO();
    ok(io, "done", makeOpts({ json: false, source: "mock" }));

    expect(io.out[0]).toContain("done");
    expect(io.out[0]).toContain("(using mock platform)");
  });

  it("renders a structured payload with a title and warnings", () => {
    const io = makeIO();
    ok(
      io,
      { title: "Apply complete", next_actions: ["review the plan"] },
      makeOpts({ json: false, source: "mock" }),
      ["non-fatal advisory"],
    );

    const text = io.out.join("");
    expect(text).toContain("Apply complete");
    expect(text).toContain("Next:");
    expect(text).toContain("review the plan");
    expect(text).toContain("Warning: non-fatal advisory");
  });
});

describe("skipped (JSON mode)", () => {
  it("writes a skipped envelope carrying the stable reason token", () => {
    const io = makeIO();
    skipped(
      io,
      "already_initialized",
      makeOpts({ json: true, command: "init" }),
      { project_id: "p-9" },
      ["zitadel status"],
    );

    expect(io.err).toEqual([]);
    const envelope = JSON.parse(io.out[0]) as SkippedEnvelope;
    expect(envelope.status).toBe("skipped");
    expect(envelope.reason).toBe("already_initialized");
    expect(envelope.command).toBe("init");
    expect(envelope.cli_version).toBe("1.2.3");
    expect(envelope.source).toBe("mock");
    expect(envelope.data).toEqual({ project_id: "p-9" });
    expect(envelope.next_commands).toEqual(["zitadel status"]);
  });
});

describe("skipped (pretty mode)", () => {
  it("writes a human-readable Skipped line and next commands", () => {
    const io = makeIO();
    skipped(io, "already_initialized", makeOpts({ json: false, source: "mock" }), undefined, [
      "zitadel status",
    ]);

    const text = io.out.join("");
    expect(io.err).toEqual([]);
    expect(text).toContain("Skipped: already_initialized");
    expect(text).toContain("(using mock platform)");
    expect(text).toContain("Next:");
    expect(text).toContain("$ zitadel status");
  });
});

describe("writeError (JSON mode)", () => {
  it("writes an error envelope with the code to stdout (not stderr)", () => {
    const io = makeIO();
    const error = new ZitadelError("E_VALIDATION", "bad flow definition", {
      hint: "fix the schema",
      nextCommands: ["zitadel apply --dry-run"],
      details: { field: "name" },
    });

    writeError(io, error, makeOpts({ json: true }));

    expect(io.err).toEqual([]);
    expect(io.out).toHaveLength(1);

    const envelope = JSON.parse(io.out[0]) as ErrorEnvelope;
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.message).toBe("bad flow definition");
    expect(envelope.hint).toBe("fix the schema");
    expect(envelope.next_commands).toEqual(["zitadel apply --dry-run"]);
    expect(envelope.details).toEqual({ field: "name" });
    expect(envelope.cli_version).toBe("1.2.3");
  });
});

describe("writeError (pretty mode)", () => {
  it("writes the error, hint, and next commands to stderr (stdout stays clean)", () => {
    const io = makeIO();
    const error = new ZitadelError("E_AUTH", "permission denied", {
      hint: "check your token",
      nextCommands: ["zitadel login"],
    });

    writeError(io, error, makeOpts({ json: false }));

    expect(io.out).toEqual([]);
    const text = io.err.join("");
    expect(text).toContain("Error E_AUTH: permission denied");
    expect(text).toContain("check your token");
    expect(text).toContain("Next:");
    expect(text).toContain("$ zitadel login");
  });

  it("omits the hint and next block when the error carries neither", () => {
    const io = makeIO();
    const error = new ZitadelError("E_CONFLICT", "already exists");

    writeError(io, error, makeOpts({ json: false }));

    const text = io.err.join("");
    expect(text).toContain("Error E_CONFLICT: already exists");
    expect(text).not.toContain("Next:");
  });
});

describe("writePretty", () => {
  it("writes the message to stdout with a trailing newline", () => {
    const io = makeIO();
    writePretty(io, "hello world");

    expect(io.out).toEqual(["hello world\n"]);
    expect(io.err).toEqual([]);
  });
});
