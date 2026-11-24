import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { readRawBody } from "@/cli/core/crud/body";
import { it } from "@tests/fixtures";

/** What a refusal suggests: the run again. */
const RETRY = { id: "setup" } as const;

describe("readRawBody", () => {
  it("parses --data", async () => {
    await expect(readRawBody({ data: '{"name":"x"}' }, RETRY)).resolves.toEqual({
      name: "x",
    });
  });

  it("reads --file", async ({ dir }) => {
    const file = join(dir, "team.json");
    await writeFile(file, '{"name":"from-file"}');
    await expect(readRawBody({ file }, RETRY)).resolves.toEqual({ name: "from-file" });
  });

  it("rejects a non-object body", async () => {
    await expect(readRawBody({ data: "[1]" }, RETRY)).rejects.toThrow();
  });

  it("returns undefined when no source was given, leaving that call to the command", async () => {
    await expect(readRawBody({}, RETRY)).resolves.toBeUndefined();
  });

  it("refuses `--file -` when stdin is a terminal, rather than waiting on it", async ({
    terminal: _terminal,
  }) => {
    await expect(readRawBody({ file: "-" }, RETRY)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "--file - reads the body from a pipe, but nothing is piped in",
      hint: "Pipe a body in and pass --file -, or pass it with --file <path> or --data '<json>'.",
      nextCommands: [{ id: "setup" }],
    });
  });
});

describe("the body as it arrives", () => {
  it("returns an inline --data body as given, leaving its content to the command", async () => {
    // `--data` is checked for credentials by the write command, beside the
    // field flags and `--set`, against the schema that says what each value
    // is; reading it judges nothing.
    await expect(
      readRawBody({ data: '{"attributes":{"password":"hunter2"}}' }, RETRY),
    ).resolves.toEqual({ attributes: { password: "hunter2" } });
  });

  it("returns the same body from a file, which never reaches argv", async ({ dir }) => {
    const file = join(dir, "body.json");
    await writeFile(file, '{"attributes":{"password":"hunter2"}}');
    await expect(readRawBody({ file }, RETRY)).resolves.toEqual({
      attributes: { password: "hunter2" },
    });
  });
});
