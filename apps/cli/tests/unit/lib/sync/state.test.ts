import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "../../../helpers/fixtures";

import { readState, updateState, type ZitadelState } from "../../../../src/lib/sync/state";

async function writeStateFile(cwd: string, state: ZitadelState): Promise<void> {
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(state));
}

describe("readState", () => {
  it("returns the parsed contents of .zitadel/state.json", async ({ dir: cwd }) => {
    const state: ZitadelState = {
      framework: "next",
      resources: { ".zitadel/schemas/user.json": { id: "schema-1", hash: "abc" } },
    };
    await writeStateFile(cwd, state);

    const result = await readState(cwd);

    expect(result).toEqual(state);
  });

  it("throws when the state file is missing", async ({ dir: cwd }) => {
    await expect(readState(cwd)).rejects.toThrow();
  });

  it("throws when the state file is malformed JSON", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/state.json"), "{ not json");

    await expect(readState(cwd)).rejects.toThrow();
  });
});

describe("updateState", () => {
  it("adds a new resource entry and round-trips through readState", async ({ dir: cwd }) => {
    await writeStateFile(cwd, { framework: "next", resources: {} });

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

  it("merges into an existing entry, preserving unspecified fields", async ({ dir: cwd }) => {
    await writeStateFile(cwd, {
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

  it("leaves other resource entries untouched", async ({ dir: cwd }) => {
    await writeStateFile(cwd, {
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

  it("writes pretty-printed JSON (two-space indent)", async ({ dir: cwd }) => {
    await writeStateFile(cwd, { framework: "next", resources: {} });

    await updateState(cwd, ".zitadel/schemas/user.json", { id: "schema-1" });

    const raw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    expect(raw).toContain('\n  "framework"');
  });
});
