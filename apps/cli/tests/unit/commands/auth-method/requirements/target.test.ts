import { describe, expect, it } from "vitest";

import { schemaTarget } from "../../../../../src/commands/auth-method/requirements/target";
import { unmet } from "../../../../../src/lib/oclif/requirements";
import { defaultSchema, makeProject, setUpProject } from "../../../../helpers/local-project";
import { requirementContext } from "../../../../helpers/requirement-context";

function contextFor(cwd: string, flags: Record<string, unknown> = {}) {
  return requirementContext({
    flags,
    meta: {
      cwd,
    },
  });
}

describe("schemaTarget", () => {
  it("finds the only schema and the flows that run against it", async () => {
    const cwd = await setUpProject();

    expect(await schemaTarget.resolve(contextFor(cwd))).toMatchObject({
      schema: {
        name: "default-human-user",
      },
      cwdArgs: [],
    });
  });

  it("carries --cwd into the follow-ups when the run had one", async () => {
    const cwd = await setUpProject();

    expect(await schemaTarget.resolve(contextFor(cwd, { cwd }))).toMatchObject({
      cwdArgs: ["--cwd", cwd],
    });
  });

  it("chooses the schema --schema names", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    expect(await schemaTarget.resolve(contextFor(cwd, { schema: "employees" }))).toMatchObject({
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

  it("is unmet for a schema that points at an external url", async () => {
    const cwd = await makeProject({
      schemas: {
        remote: {
          kind: "schema-url",
          url: "https://schemas.test.invalid/remote.json",
        },
      },
    });

    expect(await schemaTarget.resolve(contextFor(cwd))).toEqual(
      unmet({
        file: ".zitadel/schemas/remote.json",
        url: "https://schemas.test.invalid/remote.json",
      }),
    );
  });

  it("words that refusal with the file and the url in its details", () => {
    expect(schemaTarget.refusal).toMatchObject({
      message: "{file} points at an external schema",
      details: {
        file: "{file}",
        url: "{url}",
      },
    });
  });
});
