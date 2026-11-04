import { describe, expect, it } from "vitest";

import {
  Variable,
  VariableRemoval,
  VariableService,
  VariableWrite,
} from "../../../../../src/lib/backend";
import { ForbiddenError } from "../../../../../src/lib/backend/errors";

describe("VariableService.assertName", () => {
  it.each(["GOOGLE_CLIENT_ID", "retry2", "a", "_x1", "A".repeat(255)])("accepts %j", (name) => {
    expect(() => VariableService.assertName(name)).not.toThrow();
  });

  it.each(["GOOGLE-CLIENT", "a.b", "a b", ""])("refuses %j as invalid, quoting it", (name) => {
    expect(() => VariableService.assertName(name)).toThrow(
      expect.objectContaining({
        name: "InvalidError",
        message: `Invalid variable name ${JSON.stringify(name)}.`,
        hint: "A variable name contains only letters, digits and underscores.",
      }),
    );
  });

  it("refuses a name past the schema's limit, saying how long it is", () => {
    expect(() => VariableService.assertName("A".repeat(256))).toThrow(
      expect.objectContaining({
        name: "InvalidError",
        message: "Variable name is 256 characters; the limit is 255.",
        hint: "Shorten the name.",
      }),
    );
  });
});

describe("VariableWrite.kinds", () => {
  it("writes both kinds for a plain value and the primary kind for a secret", () => {
    expect(
      VariableWrite.of({
        secret: false,
        preview: false,
      }).kinds,
    ).toEqual(["primary", "preview"]);
    expect(
      VariableWrite.of({
        secret: true,
        preview: false,
      }).kinds,
    ).toEqual(["primary"]);
  });

  it("writes the preview kind alone for a preview write", () => {
    expect(
      VariableWrite.of({
        secret: false,
        preview: true,
      }).kinds,
    ).toEqual(["preview"]);
    expect(
      VariableWrite.of({
        secret: true,
        preview: true,
      }).kinds,
    ).toEqual(["preview"]);
  });
});

describe("VariableRemoval.kinds", () => {
  it("clears both kinds, or the preview kind alone", () => {
    expect(
      VariableRemoval.of({
        preview: false,
      }).kinds,
    ).toEqual(["primary", "preview"]);
    expect(
      VariableRemoval.of({
        preview: true,
      }).kinds,
    ).toEqual(["preview"]);
  });
});

describe("VariableService.set of a plain preview value", () => {
  function setFor(getVariable: () => Promise<{ primary?: unknown }>) {
    const variableService = new VariableService(
      {
        getVariable,
        getVariables: async () => {
          return {};
        },
        updateVariables: async () => {
          return {
            API_KEY: {
              preview: "x",
            },
          };
        },
      } as never,
      "proj_1",
    );
    return variableService.set(
      "API_KEY",
      "x",
      VariableWrite.of({
        secret: false,
        preview: true,
      }),
    );
  }

  it("writes it for a name whose primary value is plain", async () => {
    await expect(
      setFor(async () => {
        return {
          primary: "x",
        };
      }),
    ).resolves.toMatchObject({
      name: "API_KEY",
      outcome: "set",
    });
  });

  it("refuses it for a name whose primary value is a secret", async () => {
    await expect(
      setFor(async () => {
        return {
          primary: {
            secret: true,
          },
        };
      }),
    ).resolves.toEqual({
      name: "API_KEY",
      outcome: "needs-secret-preview",
    });
  });

  it("leaves the check to whoever can read the primary values on a 403", async () => {
    await expect(
      setFor(async () => {
        throw new ForbiddenError("Forbidden", {
          status: 403,
        });
      }),
    ).resolves.toMatchObject({
      outcome: "set",
    });
  });

  it("fails on any other error, since writing on an unknown is the outcome it guards against", async () => {
    await expect(
      setFor(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("Variable.fromValues", () => {
  it("marks secrets as held and carries no value for them", () => {
    const variables = Variable.fromValues({
      GOOGLE_CLIENT_SECRET: { secret: true },
      GOOGLE_CLIENT_ID: "999-prod",
    });

    expect(JSON.parse(JSON.stringify(variables))).toEqual([
      { name: "GOOGLE_CLIENT_ID", secret: false, value: "999-prod" },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ]);
    expect(variables[1]).not.toHaveProperty("value");
  });

  it("keeps a scalar's JSON type", () => {
    expect(
      JSON.parse(JSON.stringify(Variable.fromValues({ RETRY_COUNT: 5, DEBUG: true }))),
    ).toEqual([
      { name: "DEBUG", secret: false, value: true },
      { name: "RETRY_COUNT", secret: false, value: 5 },
    ]);
  });

  it("sorts by name so output is stable between runs", () => {
    const variables = Variable.fromValues({ B: "2", A: "1", C: "3" });
    expect(variables.map((variable) => variable.name)).toEqual(["A", "B", "C"]);
  });

  it("reports an owner that holds nothing", () => {
    expect(Variable.fromValues({})).toEqual([]);
  });
});

describe("Variable.inventory", () => {
  it("lists a name that holds only a preview value, printing a dash for the primary", () => {
    const [variable] = Variable.inventory({ API_URL: { preview: "https://preview.acme.com" } });

    expect(variable?.name).toBe("API_URL");
    expect(variable?.value).toBeUndefined();
    expect(variable?.preview).toEqual({
      secret: false,
      value: "https://preview.acme.com",
    });
  });

  it("prints a marker for a secret in either column", () => {
    const [variable] = Variable.inventory({ TOKEN: { primary: { secret: true } } });

    expect(variable?.secret).toBe(true);
    expect(variable?.preview).toBeUndefined();
  });
});
