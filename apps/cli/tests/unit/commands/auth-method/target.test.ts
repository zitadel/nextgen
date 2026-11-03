import { describe, expect, it } from "vitest";

import { readSchemaTarget } from "../../../../src/commands/auth-method/target";
import { defaultSchema, makeProject, setUpProject } from "../../../helpers/local-project";

function target(cwd: string, flags: { schema?: string; cwdGiven?: boolean } = {}) {
  return readSchemaTarget({
    cwd,
    schema: flags.schema,
    cwdGiven: flags.cwdGiven ?? false,
  });
}

describe("readSchemaTarget", () => {
  it("finds the only schema and the flows that run against it", async () => {
    const cwd = await setUpProject();

    await expect(target(cwd)).resolves.toMatchObject({
      schema: {
        name: "default-human-user",
      },
      cwdArgs: [],
    });
  });

  it("carries --cwd into the follow-ups when the run had one", async () => {
    const cwd = await setUpProject();

    await expect(target(cwd, { cwdGiven: true })).resolves.toMatchObject({
      cwdArgs: ["--cwd", cwd],
    });
  });

  it("chooses the schema --schema names", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    await expect(target(cwd, { schema: "employees" })).resolves.toMatchObject({
      schema: {
        name: "employees",
      },
    });
  });

  it("refuses a Project with more than one schema and none named", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has more than one user schema",
    });
  });

  it("refuses a Project with no schema", async () => {
    const cwd = await makeProject();

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
  });

  it("refuses a schema that points at an external url, naming the file and the url", async () => {
    const cwd = await makeProject({
      schemas: {
        remote: {
          kind: "schema-url",
          url: "https://schemas.test.invalid/remote.json",
        },
      },
    });

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: ".zitadel/schemas/remote.json points at an external schema",
      details: {
        file: ".zitadel/schemas/remote.json",
        url: "https://schemas.test.invalid/remote.json",
      },
    });
  });
});
