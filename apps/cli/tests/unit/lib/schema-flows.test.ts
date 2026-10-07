import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SchemaFile } from "../../../src/lib/idp";
import { flowsForSchema } from "../../../src/lib/schema-flows";

// Temp dirs are left for the OS to reclaim, as the integration helper does
// (#1498): a recursive delete on teardown flakes under CI load.

function schemaFile(name: string, body: Record<string, unknown> = {}): SchemaFile {
  return { name, path: `.zitadel/schemas/${name}.json`, properties: [], methods: [], body };
}

/** A Project holding flows that name the given schema references. */
async function projectWithFlows(flows: Record<string, string>, state?: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-schema-flows-"));
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  for (const [name, userSchema] of Object.entries(flows)) {
    await writeFile(
      join(cwd, `.zitadel/flows/${name}.json`),
      JSON.stringify({ name, user_schema: userSchema }),
    );
  }
  if (state !== undefined) {
    await writeFile(join(cwd, ".zitadel/state.json"), state);
  }
  return cwd;
}

const names = (flows: { name: string }[]) => flows.map((flow) => flow.name);

describe("flowsForSchema", () => {
  it("matches flows by the schema's $id", async () => {
    const cwd = await projectWithFlows({
      customers: "https://a.test/customers.json",
      staff: "https://a.test/staff.json",
    });

    const flows = await flowsForSchema(
      cwd,
      schemaFile("customers", { $id: "https://a.test/customers.json" }),
    );

    expect(names(flows)).toEqual(["customers"]);
  });

  it("does not match on the file name when the $id disagrees", async () => {
    const cwd = await projectWithFlows({ other: "https://elsewhere.test/customers.json" });

    const flows = await flowsForSchema(
      cwd,
      schemaFile("customers", { $id: "https://a.test/customers.json" }),
    );

    expect(flows).toEqual([]);
  });

  it("falls back to the file name for a schema without an $id", async () => {
    const cwd = await projectWithFlows({ login: "https://a.test/customers.json" });

    const flows = await flowsForSchema(cwd, schemaFile("customers"));

    expect(names(flows)).toEqual(["login"]);
  });

  it("matches the published id recorded in state", async () => {
    const cwd = await projectWithFlows(
      { login: "sch_PUBLISHED" },
      JSON.stringify({ resources: { ".zitadel/schemas/customers.json": { id: "sch_PUBLISHED" } } }),
    );

    const flows = await flowsForSchema(
      cwd,
      schemaFile("customers", { $id: "https://a.test/customers.json" }),
    );

    expect(names(flows)).toEqual(["login"]);
  });

  it("still matches a flow an interrupted apply left on the previous id", async () => {
    // apply records the new id and previousId before it re-pins the flows.
    const cwd = await projectWithFlows(
      { login: "sch_OLD" },
      JSON.stringify({
        resources: {
          ".zitadel/schemas/customers.json": { id: "sch_NEW", previousId: "sch_OLD" },
        },
      }),
    );

    const flows = await flowsForSchema(
      cwd,
      schemaFile("customers", { $id: "https://a.test/customers.json" }),
    );

    expect(names(flows)).toEqual(["login"]);
  });

  it.each([
    ["no resources", "{}"],
    ["resources as a list", JSON.stringify({ resources: [] })],
    [
      "an entry that is not an object",
      JSON.stringify({ resources: { ".zitadel/schemas/customers.json": "sch_1" } }),
    ],
    [
      "an id that is not a string",
      JSON.stringify({ resources: { ".zitadel/schemas/customers.json": { id: 7 } } }),
    ],
  ])("refuses a state file with %s rather than treat it as never synced", async (_, state) => {
    const cwd = await projectWithFlows({ login: "sch_PUBLISHED" }, state);

    await expect(flowsForSchema(cwd, schemaFile("customers"))).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("refuses a state file it cannot read rather than guess", async () => {
    const cwd = await projectWithFlows({ login: "https://a.test/customers.json" }, "{not json");

    await expect(flowsForSchema(cwd, schemaFile("customers"))).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
