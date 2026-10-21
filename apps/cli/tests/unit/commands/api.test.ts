import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../helpers/clack")).clackDouble());

import { select, text } from "@clack/prompts";
import { Config } from "@oclif/core";

import Api from "../../../src/commands/api/index";
import { makeProject } from "../../helpers/local-project";
import { cliPackageRoot } from "../../helpers/oclif-build";

// The prompts of `zitadel api` run without an operation. The specs run the
// built CLI, which bundles its own prompts, so a prompt is answered only by
// running the command class from source, where `input` is the one module that
// asks.

const tty = {
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
};

function restore(stream: NodeJS.WriteStream | NodeJS.ReadStream, found?: PropertyDescriptor) {
  if (found === undefined) {
    delete (stream as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(stream, "isTTY", found);
  }
}

beforeEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  restore(process.stdout, tty.stdout);
  restore(process.stdin, tty.stdin);
  vi.mocked(select).mockReset();
  vi.mocked(text).mockReset();
  vi.restoreAllMocks();
});

/** Run `zitadel api` from source with its output kept out of the test log. */
async function api(...argv: string[]) {
  return apiIn(await makeProject({ linked: true }), ...argv);
}

/** Run `zitadel api` from source in `cwd`. */
async function apiIn(cwd: string, ...argv: string[]) {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const config = await Config.load({ root: cliPackageRoot });
  return Api.run(
    ["--cwd", cwd, "--no-telemetry", "--server", "http://localhost:8080", ...argv],
    config,
  );
}

describe("zitadel api without an operation, at a terminal", () => {
  it("asks for the part of the API, the operation and its path parameters", async () => {
    vi.mocked(select).mockResolvedValueOnce("Sessions" as never);
    vi.mocked(select).mockResolvedValueOnce("revokeSession" as never);
    vi.mocked(text).mockResolvedValueOnce("sess_1" as never);

    const envelope = await api("--dry-run");

    expect(envelope).toMatchObject({
      status: "ok",
      data: { operation: "revokeSession", url: "http://localhost:8080/sessions/sess_1" },
    });
  });

  it("offers only what the CLI can call", async () => {
    vi.mocked(select).mockResolvedValueOnce("Sessions" as never);
    vi.mocked(select).mockResolvedValueOnce("getSession" as never);
    vi.mocked(text).mockResolvedValueOnce("sess_1" as never);

    await api("--dry-run");

    const offered = vi.mocked(select).mock.calls[1]?.[0].options.map((option) => option.value);
    expect(offered).toContain("getSession");
    expect(offered).not.toContain("getMySession");
  });
});

describe("zitadel api for an operation that needs no credential", () => {
  it("runs where no project was set up", async () => {
    const envelope = await apiIn(await makeProject(), "getHealth", "--dry-run");

    expect(envelope).toMatchObject({
      status: "ok",
      data: { url: "http://localhost:8080/healthz" },
    });
  });
});
