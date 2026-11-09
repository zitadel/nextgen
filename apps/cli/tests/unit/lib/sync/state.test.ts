import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { publishedIds, readState, updateScaffold, type ZitadelState } from "@/lib/sync/state";
import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The directory the state file lives in.
 */
const ZITADEL_DIR = ".zitadel";

/**
 * The state file, from the project root.
 */
const STATE_FILE = `${ZITADEL_DIR}/state.json`;

/**
 * A synced schema file, as the state file keys it.
 */
const CUSTOMERS = `${ZITADEL_DIR}/schemas/customers.json`;

/**
 * A synced flow file, which no test asks about.
 */
const LOGIN_FLOW = `${ZITADEL_DIR}/flows/login.json`;

/**
 * Writes the state file holding exactly this text.
 *
 * @param cwd - The project root.
 * @param text - The file's contents.
 */
async function writeState(cwd: string, text: string): Promise<void> {
  await mkdir(join(cwd, ZITADEL_DIR), { recursive: true });
  await writeFile(join(cwd, STATE_FILE), text);
}

describe("readState", () => {
  it("returns the parsed contents of the state file", async ({ dir }) => {
    const state: ZitadelState = { framework: "next", scaffold: { files: {}, dev_port: 3000 } };
    await writeState(dir, JSON.stringify(state));

    const result = await readState(dir);

    expect(result).toEqual(state);
  });

  describe("when the state file is missing", () => {
    it("refuses with the file system's error", async ({ dir }) => {
      const error = await rejectionOf(() => {
        return readState(dir);
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ code: "ENOENT" });
    });
  });

  describe("when the state file is not JSON", () => {
    it("refuses with the parser's error", async ({ dir }) => {
      await writeState(dir, "{ not json");

      const error = await rejectionOf(() => {
        return readState(dir);
      });

      expect(error).toBeInstanceOf(SyntaxError);
    });
  });
});

describe("updateScaffold", () => {
  it("records the manifest", async ({ dir }) => {
    await writeState(dir, JSON.stringify({ framework: "next" }));

    await updateScaffold(dir, { files: {} });

    expect(await readState(dir)).toEqual({ framework: "next", scaffold: { files: {} } });
  });

  it("keeps the rest of the file", async ({ dir }) => {
    await writeState(
      dir,
      JSON.stringify({ framework: "next", resources: { [CUSTOMERS]: { id: "sch_1" } } }),
    );

    await updateScaffold(dir, { files: {} });

    expect(await publishedIds(dir, [CUSTOMERS])).toEqual(new Map([[CUSTOMERS, ["sch_1"]]]));
  });
});

describe("publishedIds", () => {
  it("is the id a file was synced as", async ({ dir }) => {
    await writeState(dir, JSON.stringify({ resources: { [CUSTOMERS]: { id: "sch_1" } } }));

    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.get(CUSTOMERS)).toEqual(["sch_1"]);
  });

  it("keeps the id a file was synced as before, which a flow may still name", async ({ dir }) => {
    await writeState(
      dir,
      JSON.stringify({ resources: { [CUSTOMERS]: { id: "sch_NEW", previousId: "sch_OLD" } } }),
    );

    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.get(CUSTOMERS)).toEqual(["sch_NEW", "sch_OLD"]);
  });

  it("leaves out a file that was never synced", async ({ dir }) => {
    await writeState(dir, JSON.stringify({ resources: {} }));

    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.has(CUSTOMERS)).toBe(false);
  });

  it("is empty for a project that was never synced", async ({ dir }) => {
    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.size).toBe(0);
  });

  it("is empty for a state file with no resources section", async ({ dir }) => {
    await writeState(dir, JSON.stringify({ framework: "next" }));

    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.size).toBe(0);
  });

  it("does not judge an entry it was not asked about", async ({ dir }) => {
    await writeState(dir, JSON.stringify({ resources: { [LOGIN_FLOW]: { id: 7 } } }));

    const ids = await publishedIds(dir, [CUSTOMERS]);

    expect(ids.size).toBe(0);
  });

  it.for([
    { problem: "no object", text: "[]" },
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
  ])(
    "refuses a state file with $problem rather than treat it as never synced",
    async ({ text }, { dir }) => {
      await writeState(dir, text);

      const error = await rejectionOf(() => {
        return publishedIds(dir, [CUSTOMERS]);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION" });
    },
  );
});
