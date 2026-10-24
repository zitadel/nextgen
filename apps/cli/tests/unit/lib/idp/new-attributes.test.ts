import { describe, expect, it } from "vitest";

import { addAttributesToFlow, addAttributesToSchema } from "../../../../src/lib/idp";

const EMPLOYEE_NUMBER = {
  name: "employeeNumber",
  type: "integer" as const,
  required: false,
  unique: false,
};

describe("addAttributesToSchema", () => {
  it("adds each attribute as an optional property of the claim's type", () => {
    const schema = addAttributesToSchema({ properties: { email: { type: "string" } } }, [
      EMPLOYEE_NUMBER,
    ]);

    expect(schema.properties).toMatchObject({
      email: { type: "string" },
      employeeNumber: { type: "integer" },
    });
  });

  it("does not make the new property required", () => {
    const schema = addAttributesToSchema({ required: ["email"], properties: {} }, [
      EMPLOYEE_NUMBER,
    ]);

    expect(schema.required).toEqual(["email"]);
  });

  it("returns the schema untouched when there is nothing to add", () => {
    const schema = { properties: {} };

    expect(addAttributesToSchema(schema, [])).toBe(schema);
  });

  it("starts the properties when the schema has none", () => {
    expect(addAttributesToSchema({}, [EMPLOYEE_NUMBER]).properties).toMatchObject({
      employeeNumber: { type: "integer" },
    });
  });
});

describe("addAttributesToFlow", () => {
  const flow = () => ({
    steps: [
      { name: "identifier", fields: ["email"] },
      { name: "register", fields: ["email", "givenName"] },
      { name: "register-sso", fields: ["email", "givenName"] },
      { name: "password", fields: ["x-auth-methods#password"] },
    ],
  });

  it("adds the names to the steps that ask for a person's details", () => {
    const steps = addAttributesToFlow(flow(), ["employeeNumber"]).steps as {
      name: string;
      fields: string[];
    }[];

    expect(steps.find((step) => step.name === "register")?.fields).toEqual([
      "email",
      "givenName",
      "employeeNumber",
    ]);
    expect(steps.find((step) => step.name === "register-sso")?.fields).toContain("employeeNumber");
  });

  it("leaves the other steps alone", () => {
    const steps = addAttributesToFlow(flow(), ["employeeNumber"]).steps as {
      name: string;
      fields: string[];
    }[];

    expect(steps.find((step) => step.name === "identifier")?.fields).toEqual(["email"]);
    expect(steps.find((step) => step.name === "password")?.fields).toEqual([
      "x-auth-methods#password",
    ]);
  });

  it("does not list a field twice", () => {
    const steps = addAttributesToFlow(flow(), ["givenName"]).steps as {
      name: string;
      fields: string[];
    }[];

    expect(steps.find((step) => step.name === "register")?.fields).toEqual(["email", "givenName"]);
  });

  it("returns the flow untouched when there is nothing to add", () => {
    const original = flow();

    expect(addAttributesToFlow(original, [])).toBe(original);
  });
});
