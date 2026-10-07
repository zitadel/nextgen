import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SchemaFile } from "../../../src/lib/idp";
import { flowsForSchema } from "../../../src/lib/schema-flows";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function schemaFile(name: string, body: Record<string, unknown> = {}): SchemaFile {
  return { name, path: `.zitadel/schemas/${name}.json`, properties: [], methods: [], body };
}

/** A Project holding flows that name the given schema references. */
async function projectWithFlows(flows: Record<string, string>, state?: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-schema-flows-"));
  tempDirs.push(cwd);
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

  it("refuses a state file it cannot read rather than guess", async () => {
    const cwd = await projectWithFlows({ login: "https://a.test/customers.json" }, "{not json");

    await expect(flowsForSchema(cwd, schemaFile("customers"))).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
