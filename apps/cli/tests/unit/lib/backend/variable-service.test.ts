import { describe, expect, it } from "vitest";

import { Variable, VariableService } from "../../../../src/lib/backend";

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

describe("VariableService.kindsWritten", () => {
  it("writes both kinds for a plain value and the primary kind for a secret", () => {
    expect(VariableService.kindsWritten(false)).toEqual(["primary", "preview"]);
    expect(VariableService.kindsWritten(true)).toEqual(["primary"]);
  });

  it("writes the preview kind alone under preview", () => {
    expect(VariableService.kindsWritten(false, "preview")).toEqual(["preview"]);
    expect(VariableService.kindsWritten(true, "preview")).toEqual(["preview"]);
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

describe("Variable.cell", () => {
  it("carries the stored value as the server holds it, for whatever prints it to escape", () => {
    expect(Variable.of("V", "one\ntwo\u001b[31m").cell()).toEqual({
      name: "V",
      value: "one\ntwo\u001b[31m",
    });
  });

  it("prints a marker for a secret rather than an empty column", () => {
    expect(Variable.of("S", { secret: true }).cell()).toEqual({ name: "S", value: "(secret)" });
  });

  it("renders a number or a boolean as its JSON text", () => {
    expect(Variable.of("N", 5).cell().value).toBe("5");
    expect(Variable.of("B", false).cell().value).toBe("false");
  });
});

describe("Variable.inventory", () => {
  it("lists a name that holds only a preview value, printing a dash for the primary", () => {
    const [variable] = Variable.inventory({ API_URL: { preview: "https://preview.acme.com" } });

    expect(variable?.inventoryCell()).toEqual({
      name: "API_URL",
      value: "-",
      preview: "https://preview.acme.com",
    });
  });

  it("prints a marker for a secret in either column", () => {
    const [variable] = Variable.inventory({ TOKEN: { primary: { secret: true } } });

    expect(variable?.inventoryCell()).toEqual({ name: "TOKEN", value: "(secret)", preview: "-" });
  });
});
