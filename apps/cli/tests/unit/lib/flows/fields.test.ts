import { describe, expect, it } from "vitest";

import {
  BASE_LOCALE,
  completeStep,
  fieldLabelFor,
  fieldTypeFor,
  identifierStep,
  registerFieldLocale,
  registerProfileStep,
} from "../../../../src/lib/flows/fields";

describe("fieldTypeFor", () => {
  it("maps known fields to their renderer input type", () => {
    expect(fieldTypeFor("email")).toBe("email");
    expect(fieldTypeFor("phone")).toBe("tel");
    expect(fieldTypeFor("password")).toBe("password");
    expect(fieldTypeFor("date_of_birth")).toBe("date");
    expect(fieldTypeFor("birthdate")).toBe("date");
  });

  it("falls back to text for unknown fields", () => {
    expect(fieldTypeFor("given_name")).toBe("text");
    expect(fieldTypeFor("unknown_field")).toBe("text");
  });
});

describe("fieldLabelFor", () => {
  it("returns English labels for known fields", () => {
    expect(fieldLabelFor("email")).toBe("Email address");
    expect(fieldLabelFor("given_name")).toBe("First name");
    expect(fieldLabelFor("family_name")).toBe("Last name");
    expect(fieldLabelFor("phone")).toBe("Phone number");
    expect(fieldLabelFor("date_of_birth")).toBe("Date of birth");
    expect(fieldLabelFor("birthdate")).toBe("Date of birth");
  });

  it("returns an empty string for unknown fields", () => {
    expect(fieldLabelFor("unknown_field")).toBe("");
  });
});

describe("BASE_LOCALE", () => {
  it("contains the cross-method seed keys", () => {
    expect(BASE_LOCALE["identifier.title"]).toBe("Sign in");
    expect(BASE_LOCALE["credential.action.submit"]).toBe("Sign in");
    expect(BASE_LOCALE["register_profile.action.submit"]).toBe("Create account");
    expect(BASE_LOCALE["complete.title"]).toBe("You're signed in");
  });

  it("is frozen so callers cannot mutate it", () => {
    expect(Object.isFrozen(BASE_LOCALE)).toBe(true);
  });
});

describe("identifierStep", () => {
  it("emits the identifier step with the email field and register pivot", () => {
    const step = identifierStep();
    expect(step.name).toBe("identifier");
    expect(step.type).toBe("identifier");
    expect(step.fields.email?.type).toBe("email");
    expect(step.actions.submit?.primary).toBe(true);
    expect(step.transitions).toMatchObject({
      submit: "credential",
      register: { pivot: "register" },
    });
  });
});

describe("registerProfileStep", () => {
  it("collects the requested fields with synthesized text_keys", () => {
    const step = registerProfileStep(["email", "given_name", "phone"]);
    expect(step.name).toBe("register_profile");
    expect(step.fields.email?.text_key).toBe("register_profile.field.email");
    expect(step.fields.email?.type).toBe("email");
    expect(step.fields.given_name?.type).toBe("text");
    expect(step.fields.phone?.type).toBe("tel");
    expect(step.transitions).toMatchObject({
      submit: "complete",
      login: { pivot: "login" },
    });
  });

  it("emits an empty fields map when no fields are requested", () => {
    const step = registerProfileStep([]);
    expect(step.fields).toEqual({});
  });
});

describe("completeStep", () => {
  it("is terminal: no fields, no actions, no transitions", () => {
    const step = completeStep();
    expect(step.name).toBe("complete");
    expect(step.type).toBe("complete");
    expect(step.fields).toEqual({});
    expect(step.actions).toEqual({});
    expect(step.transitions).toBeUndefined();
  });
});

describe("registerFieldLocale", () => {
  it("returns one entry per field with its English label", () => {
    expect(registerFieldLocale(["email", "given_name", "unknown"])).toEqual({
      "register_profile.field.email": "Email address",
      "register_profile.field.given_name": "First name",
      "register_profile.field.unknown": "",
    });
  });

  it("returns an empty object for no fields", () => {
    expect(registerFieldLocale([])).toEqual({});
  });
});
