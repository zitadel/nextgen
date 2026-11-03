import { describe, expect, it } from "vitest";

import type { GlobalOptions } from "../../../../../src/lib/oclif";
import { schemaTarget } from "../../../../../src/lib/oclif/requires/schema";
import { defaultSchema, makeProject, setUpProject } from "../../../../helpers/local-project";

function contextFor(cwd: string, flags: Record<string, unknown> = {}) {
  return {
    flags,
    args: {},
    meta: {
      cwd,
    } as GlobalOptions,
    resolved: {},
  };
}

describe("schemaTarget", () => {
  it("finds the only schema and the flows that run against it", async () => {
    const cwd = await setUpProject();

    const target = await schemaTarget.resolve(contextFor(cwd));

    expect(target?.schema.name).toBe("default-human-user");
    expect(target?.flows.map((flow) => flow.path)).toEqual([
      ".zitadel/flows/default-human-user-login.json",
    ]);
    expect(target?.cwdArgs).toEqual([]);
  });

  it("carries --cwd into the follow-ups when the run had one", async () => {
    const cwd = await setUpProject();

    const target = await schemaTarget.resolve(contextFor(cwd, { cwd }));

    expect(target?.cwdArgs).toEqual(["--cwd", cwd]);
  });

  it("chooses the schema --schema names", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    const target = await schemaTarget.resolve(contextFor(cwd, { schema: "employees" }));

    expect(target?.schema.name).toBe("employees");
  });

  it("refuses a Project with more than one schema and none named", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    await expect(schemaTarget.resolve(contextFor(cwd))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has more than one user schema",
    });
  });

  it("refuses a Project with no schema", async () => {
    const cwd = await makeProject();

    await expect(schemaTarget.resolve(contextFor(cwd))).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
  });

  it("refuses a schema that points at an external url", async () => {
    const cwd = await makeProject({
      schemas: {
        remote: {
          kind: "schema-url",
          url: "https://schemas.test.invalid/remote.json",
        },
      },
    });

    await expect(schemaTarget.resolve(contextFor(cwd))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: ".zitadel/schemas/remote.json points at an external schema",
      details: {
        file: ".zitadel/schemas/remote.json",
      },
    });
  });
});
