import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readRawBody } from "../../../../../src/lib/oclif/crud/body";

describe("readRawBody", () => {
  it("parses --data", async () => {
    await expect(readRawBody({ data: '{"name":"x"}' }, "teams create")).resolves.toEqual({
      name: "x",
    });
  });

  it("reads --file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-body-"));
    const file = join(dir, "team.json");
    await writeFile(file, '{"name":"from-file"}');
    await expect(readRawBody({ file }, "teams create")).resolves.toEqual({ name: "from-file" });
  });

  it("rejects a non-object body", async () => {
    await expect(readRawBody({ data: "[1]" }, "teams create")).rejects.toThrow();
  });

  it("returns undefined when no source was given, leaving that call to the command", async () => {
    await expect(readRawBody({}, "teams create")).resolves.toBeUndefined();
  });

  it("refuses `--file -` when stdin is a terminal, rather than waiting on it", async () => {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await expect(readRawBody({ file: "-" }, "users create")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "--file - reads the body from a pipe, but nothing is piped in",
        hint: expect.stringContaining("cat body.json | zitadel users create"),
      });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
    }
  });
});

describe("credentials on the command line", () => {
  it("refuses a secret nested anywhere in an inline --data body", async () => {
    await expect(
      readRawBody({ data: '{"attributes":{"email":"a@b.c","password":"hunter2"}}' }, "users create"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining('Refusing to read "password" from --data'),
      hint: expect.stringContaining("--file -"),
    });
  });

  it("accepts the same body from a file, which never reaches argv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-secret-"));
    const file = join(dir, "body.json");
    await writeFile(file, '{"attributes":{"password":"hunter2"}}');
    await expect(readRawBody({ file }, "users create")).resolves.toEqual({
      attributes: { password: "hunter2" },
    });
  });

  it("leaves ordinary bodies alone", async () => {
    await expect(readRawBody({ data: '{"name":"platform"}' }, "teams create")).resolves.toEqual({
      name: "platform",
    });
  });
});
