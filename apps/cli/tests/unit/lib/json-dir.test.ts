import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { readJsonDir } from "../../../src/lib/json-dir";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-json-dir-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readJsonDir", () => {
  it("returns an empty array when the directory is missing", async () => {
    expect(await readJsonDir(join(dir, "missing"))).toEqual([]);
  });

  it("throws E_VALIDATION when requireDir is true and the directory is missing", async () => {
    await expect(
      readJsonDir(join(dir, "missing"), { requireDir: true }),
    ).rejects.toBeInstanceOf(ZitadelError);
  });

  it("uses the supplied missingMessage and nextCommands when requireDir triggers", async () => {
    let caught: unknown;
    try {
      await readJsonDir(join(dir, "missing"), {
        requireDir: true,
        missingMessage: "scaffold first",
        missingNextCommands: ["zitadel setup"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).message).toContain("scaffold first");
    expect((caught as ZitadelError).nextCommands).toEqual(["zitadel setup"]);
  });

  it("reads .json files in lexical order", async () => {
    await writeFile(join(dir, "b.json"), JSON.stringify({ id: "b" }));
    await writeFile(join(dir, "a.json"), JSON.stringify({ id: "a" }));
    const result = await readJsonDir(dir);
    expect(result.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("preserves unknown / forward-compatible keys", async () => {
    await writeFile(
      join(dir, "x.json"),
      JSON.stringify({ id: "x", "x-custom": "${ENV_VAR}" }),
    );
    const result = await readJsonDir(dir);
    expect(result[0]["x-custom"]).toBe("${ENV_VAR}");
  });

  it("throws on invalid JSON", async () => {
    await writeFile(join(dir, "bad.json"), "{not json");
    await expect(readJsonDir(dir)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("rejects JSON arrays and primitives at the root", async () => {
    await writeFile(join(dir, "arr.json"), JSON.stringify([]));
    await expect(readJsonDir(dir)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("ignores files that don't end in .json", async () => {
    await writeFile(join(dir, "good.json"), JSON.stringify({ id: "g" }));
    await writeFile(join(dir, "README.md"), "not json");
    const result = await readJsonDir(dir);
    expect(result).toHaveLength(1);
  });
});
