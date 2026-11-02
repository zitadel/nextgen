import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeBackResource } from "../../../../src/lib/sync/writeback";

const cwd = mkdtempSync(join(tmpdir(), "zitadel-writeback-"));

beforeEach(async () => {
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("writeBackResource", () => {
  it("writes the file when none is on disk", async () => {
    const result = await writeBackResource(cwd, "user.json", {}, { name: "user" });

    expect(result.changed).toBe(true);
    expect(JSON.parse(await readFile(join(cwd, "user.json"), "utf8"))).toEqual({ name: "user" });
  });

  it("leaves a file that already matches untouched", async () => {
    await writeFile(join(cwd, "user.json"), '{ "name":   "user" }');

    const result = await writeBackResource(cwd, "user.json", {}, { name: "user" });

    expect(result.changed).toBe(false);
    expect(await readFile(join(cwd, "user.json"), "utf8")).toBe('{ "name":   "user" }');
  });

  it("carries the on-disk $schema pointer over", async () => {
    await writeFile(join(cwd, "user.json"), '{ "$schema": "./meta/user.json", "name": "old" }');

    await writeBackResource(cwd, "user.json", {}, { name: "user" });

    expect(JSON.parse(await readFile(join(cwd, "user.json"), "utf8"))).toEqual({
      $schema: "./meta/user.json",
      name: "user",
    });
  });

  it("rewrites a file the comparison form cannot read instead of failing", async () => {
    await writeFile(join(cwd, "user.json"), "null");
    const strict = {
      normalize(data: object): object {
        return { name: (data as { name: string }).name.trim() };
      },
    };

    const result = await writeBackResource(cwd, "user.json", strict, { name: "user" });

    expect(result.changed).toBe(true);
    expect(JSON.parse(await readFile(join(cwd, "user.json"), "utf8"))).toEqual({ name: "user" });
  });
});
