import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { publishedIds, readState, updateState, type ZitadelState } from "@/lib/sync/state";

const CUSTOMERS = ".zitadel/schemas/customers.json";

/** Write a state file holding exactly this text. */
async function writeStateText(cwd: string, text: string): Promise<void> {
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/state.json"), text);
}

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

describe("publishedIds", () => {
  it("is the id a file was synced as", async ({ dir: cwd }) => {
    await writeStateFile(cwd, { framework: "next", resources: { [CUSTOMERS]: { id: "sch_1" } } });

    const ids = await publishedIds(cwd, [CUSTOMERS]);

    expect(ids.get(CUSTOMERS)).toEqual(["sch_1"]);
  });

  it("keeps the id a file was synced as before, which a flow may still name", async ({
    dir: cwd,
  }) => {
    await writeStateFile(cwd, {
      framework: "next",
      resources: { [CUSTOMERS]: { id: "sch_NEW", previousId: "sch_OLD" } },
    });

    const ids = await publishedIds(cwd, [CUSTOMERS]);

    expect(ids.get(CUSTOMERS)).toEqual(["sch_NEW", "sch_OLD"]);
  });

  it("leaves out a file that was never synced", async ({ dir: cwd }) => {
    await writeStateFile(cwd, { framework: "next", resources: {} });

    const ids = await publishedIds(cwd, [CUSTOMERS]);

    expect(ids.has(CUSTOMERS)).toBe(false);
  });

  it("is empty for a project that was never synced", async ({ dir: cwd }) => {
    const ids = await publishedIds(cwd, [CUSTOMERS]);

    expect(ids.size).toBe(0);
  });

  it("does not judge an entry it was not asked about", async ({ dir: cwd }) => {
    await writeStateText(
      cwd,
      JSON.stringify({ resources: { ".zitadel/flows/login.json": { id: 7 } } }),
    );

    const ids = await publishedIds(cwd, [CUSTOMERS]);

    expect(ids.size).toBe(0);
  });

  it.for([
    { problem: "no resources", text: "{}" },
    { problem: "resources as a list", text: JSON.stringify({ resources: [] }) },
    {
      problem: "an entry that is not an object",
      text: JSON.stringify({ resources: { [CUSTOMERS]: "sch_1" } }),
    },
    {
      problem: "an id that is not a string",
      text: JSON.stringify({ resources: { [CUSTOMERS]: { id: 7 } } }),
    },
    { problem: "an empty id", text: JSON.stringify({ resources: { [CUSTOMERS]: { id: "" } } }) },
    { problem: "text that is not JSON", text: "{not json" },
  ])("refuses a state file with $problem rather than treat it as never synced", async ({
    text,
  }, { dir: cwd }) => {
    await writeStateText(cwd, text);

    await expect(publishedIds(cwd, [CUSTOMERS])).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
