import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildConfigurationBundle, resolveSchemaHandle } from "../../../src/lib/bundle";

async function aProject(files: Record<string, object>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-bundle-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), JSON.stringify(body));
  }
  return dir;
}

describe("buildConfigurationBundle", () => {
  it("carries schemas and flows with the flow's schema rewritten to its handle", async () => {
    const cwd = await aProject({
      ".zitadel/schemas/user.json": { objectType: "user", type: "object" },
      ".zitadel/flows/login.json": {
        $schema: "https://nextgen.com/flow-definition.json",
        name: "default",
        user_schema: "sch_01DEV",
      },
    });

    const { body, resources } = await buildConfigurationBundle(cwd);

    expect(body.bundle.schemas).toEqual([{ objectType: "user", type: "object" }]);
    expect(body.bundle.flow_definitions).toEqual([{ name: "default", user_schema: "user" }]);
    expect(body.bundle.brandings).toEqual([]);
    expect(resources.map((r) => [r.kind, r.handle])).toEqual([
      ["schema", "user"],
      ["flow_definition", "default"],
    ]);
  });

  it("maps an id the state file recorded to the schema it belongs to", async () => {
    const cwd = await aProject({
      ".zitadel/schemas/customer.json": { objectType: "customer" },
      ".zitadel/schemas/staff.json": { objectType: "staff" },
      ".zitadel/flows/login.json": { name: "default", user_schema: "sch_STAFF" },
      ".zitadel/state.json": {
        framework: "next",
        resources: { ".zitadel/schemas/staff.json": { id: "sch_STAFF", hash: "x" } },
      },
    });

    const { body } = await buildConfigurationBundle(cwd);

    expect((body.bundle.flow_definitions as Array<{ user_schema: string }>)[0].user_schema).toBe("staff");
  });

  it("is empty for a directory without resources", async () => {
    const { resources } = await buildConfigurationBundle(await aProject({}));
    expect(resources).toEqual([]);
  });
});

describe("resolveSchemaHandle", () => {
  const byID = new Map([["sch_A", "user"]]);

  it("prefers a known id, then a handle, then the only local schema", () => {
    expect(resolveSchemaHandle("sch_A", byID, ["user"])).toBe("user");
    expect(resolveSchemaHandle("user", byID, ["user"])).toBe("user");
    expect(resolveSchemaHandle("sch_UNKNOWN", byID, ["user"])).toBe("user");
  });

  it("passes an unknown id through when several schemas could own it", () => {
    expect(resolveSchemaHandle("sch_UNKNOWN", byID, ["user", "staff"])).toBe("sch_UNKNOWN");
    expect(resolveSchemaHandle("https://example.com/s.json", byID, ["user"])).toBe(
      "https://example.com/s.json",
    );
  });
});
