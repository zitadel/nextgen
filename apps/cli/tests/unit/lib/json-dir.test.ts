import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "../../helpers/fixtures";

import { ZitadelError } from "../../../src/lib/errors";
import { readJsonDir, readJsonDirEntries } from "../../../src/lib/json-dir";

describe("readJsonDir", () => {
  it("returns an empty array when the directory is missing", async ({ dir }) => {
    expect(await readJsonDir(join(dir, "missing"))).toEqual([]);
  });

  it("reads .json files in lexical order", async ({ dir }) => {
    await writeFile(join(dir, "b.json"), JSON.stringify({ id: "b" }));
    await writeFile(join(dir, "a.json"), JSON.stringify({ id: "a" }));
    const result = await readJsonDir(dir);
    expect(result.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("preserves unknown / forward-compatible keys", async ({ dir }) => {
    await writeFile(join(dir, "x.json"), JSON.stringify({ id: "x", "x-custom": "${ENV_VAR}" }));
    const result = await readJsonDir(dir);
    expect(result[0]!["x-custom"]!).toBe("${ENV_VAR}");
  });

  it("throws on invalid JSON", async ({ dir }) => {
    await writeFile(join(dir, "bad.json"), "{not json");
    await expect(readJsonDir(dir)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("rejects JSON arrays and primitives at the root", async ({ dir }) => {
    await writeFile(join(dir, "arr.json"), JSON.stringify([]));
    await expect(readJsonDir(dir)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("ignores files that don't end in .json", async ({ dir }) => {
    await writeFile(join(dir, "good.json"), JSON.stringify({ id: "g" }));
    await writeFile(join(dir, "README.md"), "not json");
    const result = await readJsonDir(dir);
    expect(result).toHaveLength(1);
  });
});

describe("readJsonDirEntries", () => {
  it("keeps each file name with its body, in lexical order", async ({ dir }) => {
    await writeFile(join(dir, "b.json"), JSON.stringify({ id: "b" }));
    await writeFile(join(dir, "a.json"), JSON.stringify({ id: "a" }));
    expect(await readJsonDirEntries(dir)).toEqual([
      { name: "a.json", body: { id: "a" } },
      { name: "b.json", body: { id: "b" } },
    ]);
  });

  it("returns an empty array when the directory is missing", async ({ dir }) => {
    expect(await readJsonDirEntries(join(dir, "missing"))).toEqual([]);
  });

  it("leaves out the files skip names without reading them", async ({ dir }) => {
    await writeFile(join(dir, "a.json"), JSON.stringify({ id: "a" }));
    await writeFile(join(dir, "a.test.json"), "not json");

    const entries = await readJsonDirEntries(dir, { skip: (name) => name.endsWith(".test.json") });

    expect(entries).toEqual([{ name: "a.json", body: { id: "a" } }]);
  });
});
