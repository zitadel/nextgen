import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { Config } from "@oclif/core";

import Api, { readOperation } from "@/commands/api/index";
import { unscopedCommand } from "@/lib/suggestion";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/helpers/fixtures";
import { makeProject } from "@tests/helpers/local-project";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { type Answer, answering } from "@tests/helpers/keyboard";
import { runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";

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
  vi.restoreAllMocks();
});

/**
 * Run `zitadel api` from source in a project written to `dir`, with a person giving
 * `answers` at the prompts it draws, and give back the result and what was asked.
 */
async function asking(dir: string, answers: Answer[], ...argv: string[]) {
  const cwd = await makeProject(dir, { linked: true });
  const config = await Config.load({ root: cliPackageRoot });
  const talk = answering(...answers);
  const result = await asTerminal(() =>
    Api.run(["--cwd", cwd, "--no-telemetry", "--server", "http://localhost:8080", ...argv], config),
  );
  return { result, talk };
}

/**
 * Run `zitadel api` from source in a linked project written to `dir`, with its
 * output kept out of the test log.
 */
async function api(dir: string, ...argv: string[]) {
  return apiIn(await makeProject(dir, { linked: true }), ...argv);
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

describe("zitadel api help", () => {
  it("is no operation, in any case and whatever follows", async ({ dir }) => {
    const envelope = await api(dir, "Help", "getVariable");

    expect(envelope).toMatchObject({ status: "ok", data: {} });
  });

  it("opens no telemetry and resolves no server", async ({ dir }) => {
    const toMeta = vi.spyOn(Api.prototype as unknown as { toMeta: () => unknown }, "toMeta");

    await api(dir, "help");

    expect(toMeta).not.toHaveBeenCalled();
  });
});

describe("zitadel api without an operation, at a terminal", () => {
  const choosingRevokeSession = ["Sessions", "DELETE /sessions/{session_id}", "sess_1"];

  it("asks for the part of the API, the operation and its path parameters", async ({ dir }) => {
    const { result } = await asking(dir, choosingRevokeSession, "--dry-run");

    expect(result).toMatchObject({
      status: "ok",
      data: { operation: "revokeSession", url: "http://localhost:8080/api/v1/sessions/sess_1" },
    });
  });

  it("words each of its three questions as a question", async ({ dir }) => {
    const { talk } = await asking(dir, choosingRevokeSession, "--dry-run");

    expect(talk.asked()).toEqual([
      "Which part of the API would you like to use?",
      "Which operation would you like to run?",
      "What is the value of session_id?",
    ]);
  });

  it("asks before a destructive call, naming the project and the server", async ({ dir }) => {
    const { talk } = await asking(dir, [...choosingRevokeSession, false]);

    expect(talk.asked().at(-1)).toBe(
      "Call revokeSession in project proj_01TEST on localhost:8080? Revoke a session.",
    );
  });

  it("offers only what the CLI can call", async ({ dir }) => {
    const { talk } = await asking(dir, choosingRevokeSession, "--dry-run");

    const operations = JSON.stringify(talk.options()[1]);
    expect(operations).toContain("GET /sessions/{session_id}");
    expect(operations).not.toContain("GET /sessions/me");
  });
});

describe("zitadel api for an operation that needs no credential", () => {
  it("runs where no project was set up", async ({ dir }) => {
    const envelope = await apiIn(await makeProject(dir), "getLive", "--dry-run");

    expect(envelope).toMatchObject({
      status: "ok",
      data: { url: "http://localhost:8080/api/v1/livez" },
    });
  });
});

describe("zitadel api, rendered for a terminal", () => {
  it("answers with the response and one footer, drawing no box", async ({ dir }) => {
    const cwd = await makeProject(dir, { linked: true });

    const res = await asTerminal(() =>
      runCliForTest([
        "api",
        "getLive",
        "--dry-run",
        "--cwd",
        cwd,
        "--no-telemetry",
        "--server",
        "http://localhost:8080",
      ]),
    );

    // A call that answers is drawn like every other answer: the response at
    // the margin and one footer line, with no chain and no box around it.
    // Asserting on the box's wording here would pass however it is drawn.
    const shown = stripAnsi(res.stdout);
    expect(shown).not.toContain("╭");
    expect(shown).toContain("curl -X GET 'http://localhost:8080/api/v1/livez'");
    expect(shown).toContain("Would call getLive");
    expect(shown).toContain("project proj_01TEST");
  });
});

describe("zitadel api for an operation the CLI cannot call", () => {
  it("suggests listing what it can call", () => {
    const error = ((): unknown => {
      try {
        readOperation("getMyUser", undefined, (next) => {
          return unscopedCommand(next);
        });
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(ZitadelError);
    expect((error as ZitadelError).nextCommands).toEqual([unscopedCommand("api ls")]);
  });
});

describe("zitadel api, answering a call at a terminal", () => {
  it("draws its summary, with the response under it", async ({ dir, serve }) => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "serving" }));
    });
    const cwd = await makeProject(dir, { linked: true });

    const res = await asTerminal(() =>
      runCliForTest(["api", "getLive", "--cwd", cwd, "--no-telemetry", "--server", url]),
    );

    const shown = stripAnsi(res.stdout);
    expect(shown).toContain("Called getLive");
    expect(shown).toContain("serving");
  });
});
