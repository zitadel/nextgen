import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../helpers/clack")).clackDouble());

import { select } from "@clack/prompts";
import { Config } from "@oclif/core";

import Api from "../../../src/commands/api/index";
import { makeProject } from "../../helpers/local-project";
import { cliPackageRoot } from "../../helpers/oclif-build";
import { stripAnsi } from "../../helpers/run-cli";
import { type Answer, asTerminalTyping } from "../../helpers/terminal";

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
  vi.restoreAllMocks();
});

/**
 * Run `zitadel api` from source with a person typing `answers` at the plain
 * questions it asks, and give back what it wrote.
 */
async function asking(answers: Answer[], ...argv: string[]) {
  const cwd = await makeProject({ linked: true });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const config = await Config.load({ root: cliPackageRoot });
  return asTerminalTyping(answers, () =>
    Api.run(["--cwd", cwd, "--no-telemetry", "--server", "http://localhost:8080", ...argv], config),
  );
}

/** Types the number the listing gave the choice whose line holds `label`. */
const picking =
  (label: string): Answer =>
  (shown: string) => {
    const line = shown.split("\n").find((one) => /^\s*\d+\)/.test(one) && one.includes(label));
    return /^\s*(\d+)\)/.exec(line ?? "")?.[1] ?? "";
  };

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
  const choosingRevokeSession: Answer[] = [
    picking("Sessions"),
    picking("DELETE /sessions/{session_id}"),
    "sess_1",
  ];

  it("asks for the part of the API, the operation and its path parameters", async () => {
    const { result } = await asking(choosingRevokeSession, "--dry-run");

    expect(result).toMatchObject({
      status: "ok",
      data: { operation: "revokeSession", url: "http://localhost:8080/sessions/sess_1" },
    });
  });

  it("words each of its three questions as a question", async () => {
    const { shown } = await asking(choosingRevokeSession, "--dry-run");

    expect(stripAnsi(shown)).toContain("Which part of the API would you like to use?");
    expect(stripAnsi(shown)).toContain("Which operation would you like to run?");
    expect(stripAnsi(shown)).toContain("What is the value of session_id? ");
  });

  // `api` is a normal command, so it asks plainly: numbered choices, with no
  // chain drawn around them.
  it("numbers its choices rather than drawing a prompt", async () => {
    const { shown } = await asking(choosingRevokeSession, "--dry-run");

    expect(select).not.toHaveBeenCalled();
    expect(stripAnsi(shown)).toMatch(/^ {2}\d+\) {2}Sessions$/m);
  });

  it("offers only what the CLI can call", async () => {
    const { shown } = await asking(choosingRevokeSession, "--dry-run");

    expect(stripAnsi(shown)).toContain("GET /sessions/{session_id}");
    expect(stripAnsi(shown)).not.toContain("GET /sessions/me");
  });
});

describe("zitadel api for an operation that needs no credential", () => {
  it("runs where no project was set up", async () => {
    const envelope = await apiIn(await makeProject(), "getLive", "--dry-run");

    expect(envelope).toMatchObject({
      status: "ok",
      data: { url: "http://localhost:8080/livez" },
    });
  });
});

describe("zitadel api, rendered for a terminal", () => {
  it("answers with the response and one footer, drawing no box", async () => {
    const cwd = await makeProject({ linked: true });
    const drawn: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      drawn.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const config = await Config.load({ root: cliPackageRoot });

    await Api.run(
      ["--cwd", cwd, "--no-telemetry", "--server", "http://localhost:8080", "getLive", "--dry-run"],
      config,
    );

    // A call that answers is drawn like every other answer: the response at
    // the margin and one footer line, with no chain and no box around it.
    // Asserting on the box's wording here would pass however it is drawn.
    const shown = stripAnsi(drawn.join(""));
    expect(shown).not.toContain("╭");
    expect(shown).toContain("project proj_01TEST");
  });
});
