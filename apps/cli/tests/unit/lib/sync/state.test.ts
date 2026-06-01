import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readState,
  removeFromState,
  updateState,
  type ZitadelState,
} from "../../../../src/lib/sync/state";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-state-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function writeStateFile(state: ZitadelState): Promise<void> {
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(state));
}

async function readStateFile(): Promise<ZitadelState> {
  const raw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
  return JSON.parse(raw) as ZitadelState;
}

describe("readState", () => {
  it("returns the parsed contents of .zitadel/state.json", async () => {
    const state: ZitadelState = {
      framework: "next",
      resources: { ".zitadel/schemas/user.json": { id: "schema-1", hash: "abc" } },
    };
    await writeStateFile(state);

    const result = await readState(cwd);

    expect(result).toEqual(state);
  });

  it("throws when the state file is missing", async () => {
    await expect(readState(cwd)).rejects.toThrow();
  });

  it("throws when the state file is malformed JSON", async () => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/state.json"), "{ not json");

    await expect(readState(cwd)).rejects.toThrow();
  });
});

describe("updateState", () => {
  it("adds a new resource entry and round-trips through readState", async () => {
    await writeStateFile({ framework: "next", resources: {} });

    await updateState(cwd, ".zitadel/schemas/user.json", {
      id: "schema-1",
      hash: "abc",
    });

    const result = await readState(cwd);
    expect(result.resources[".zitadel/schemas/user.json"]).toEqual({
      id: "schema-1",
      hash: "abc",
    });
    expect(result.framework).toBe("next");
  });

  it("merges into an existing entry, preserving unspecified fields", async () => {
    await writeStateFile({
      framework: "next",
      resources: { ".zitadel/flows/default.json": { id: "flow-1", hash: "old" } },
    });

    await updateState(cwd, ".zitadel/flows/default.json", { hash: "new" });

    const result = await readState(cwd);
    expect(result.resources[".zitadel/flows/default.json"]).toEqual({
      id: "flow-1",
      hash: "new",
    });
  });

  it("leaves other resource entries untouched", async () => {
    await writeStateFile({
      framework: "next",
      resources: {
        ".zitadel/schemas/a.json": { id: "a", hash: "ha" },
        ".zitadel/schemas/b.json": { id: "b", hash: "hb" },
      },
    });

    await updateState(cwd, ".zitadel/schemas/a.json", { hash: "ha2" });

    const result = await readState(cwd);
    expect(result.resources[".zitadel/schemas/a.json"]).toEqual({ id: "a", hash: "ha2" });
    expect(result.resources[".zitadel/schemas/b.json"]).toEqual({ id: "b", hash: "hb" });
  });

  it("writes pretty-printed JSON (two-space indent)", async () => {
    await writeStateFile({ framework: "next", resources: {} });

    await updateState(cwd, ".zitadel/schemas/user.json", { id: "schema-1" });

    const raw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    expect(raw).toContain('\n  "framework"');
  });
});

describe("removeFromState", () => {
  it("drops the named resource entry", async () => {
    await writeStateFile({
      framework: "next",
      resources: {
        ".zitadel/schemas/a.json": { id: "a", hash: "ha" },
        ".zitadel/schemas/b.json": { id: "b", hash: "hb" },
      },
    });

    await removeFromState(cwd, ".zitadel/schemas/a.json");

    const result = await readState(cwd);
    expect(result.resources).not.toHaveProperty(".zitadel/schemas/a.json");
    expect(result.resources[".zitadel/schemas/b.json"]).toEqual({ id: "b", hash: "hb" });
    expect(result.framework).toBe("next");
  });

  it("is a no-op when the key is absent", async () => {
    const state: ZitadelState = {
      framework: "next",
      resources: { ".zitadel/schemas/a.json": { id: "a", hash: "ha" } },
    };
    await writeStateFile(state);

    await removeFromState(cwd, ".zitadel/schemas/missing.json");

    const result = await readStateFile();
    expect(result).toEqual(state);
  });
});
