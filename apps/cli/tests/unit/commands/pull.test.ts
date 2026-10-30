import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyTarget,
  fileList,
  RECONSTRUCTABLE,
  relPathForHandle,
} from "../../../src/commands/pull";

describe("fileList", () => {
  it("says what the paths under it are", () => {
    expect(fileList([".zitadel/schemas/human-user.json"], false)).toBe(
      "\nFiles written:\n  .zitadel/schemas/human-user.json",
    );
  });

  it("says a dry run would write them, rather than that it did", () => {
    expect(fileList([".zitadel/schemas/human-user.json"], true)).toBe(
      "\nFiles it would write:\n  .zitadel/schemas/human-user.json",
    );
  });

  it("lists nothing, and leads nothing, when no file was written", () => {
    expect(fileList([], false)).toBe("");
  });
});

describe("classifyTarget", () => {
  it("reads 'latest' as the live release", () => {
    expect(classifyTarget("latest")).toEqual({ kind: "latest" });
  });

  it("reads a rel_ id as a release", () => {
    expect(classifyTarget("rel_01ABC")).toEqual({ kind: "release", id: "rel_01ABC" });
  });

  it("reads a dep_ id as a deployment", () => {
    expect(classifyTarget("dep_01ABC")).toEqual({ kind: "deployment", id: "dep_01ABC" });
  });

  it("rejects anything else", () => {
    expect(classifyTarget("sch_01ABC").kind).toBe("invalid");
    expect(classifyTarget("human-user").kind).toBe("invalid");
  });
});

describe("relPathForHandle", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  async function aProjectWith(relPath: string, body: object): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-pull-unit-"));
    dirs.push(cwd);
    await mkdir(join(cwd, RECONSTRUCTABLE.schema.dir), { recursive: true });
    await writeFile(join(cwd, relPath), JSON.stringify(body));
    return cwd;
  }

  it("overwrites the existing file that already holds the handle, whatever its name", async () => {
    const cwd = await aProjectWith(".zitadel/schemas/default-human-user.json", {
      objectType: "human-user",
    });

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.schema, "human-user");

    expect(relPath).toBe(".zitadel/schemas/default-human-user.json");
  });

  it("writes <handle>.json when no existing file holds the handle", async () => {
    const cwd = await aProjectWith(".zitadel/schemas/default-human-user.json", {
      objectType: "human-user",
    });

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.schema, "machine-user");

    expect(relPath).toBe(".zitadel/schemas/machine-user.json");
  });

  it("writes <handle>.json when the directory does not exist yet", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-pull-unit-"));
    dirs.push(cwd);

    const relPath = await relPathForHandle(cwd, RECONSTRUCTABLE.flow_definition, "default-login");

    expect(relPath).toBe(".zitadel/flows/default-login.json");
  });
});
