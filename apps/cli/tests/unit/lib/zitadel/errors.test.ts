import { describe, expect, it } from "vitest";

import { googleSelection } from "@tests/helpers/idp-values";
import {
  BrokenFlowsError,
  ConflictError,
  ConnectionExistsError,
  NoSignInLeftError,
} from "@/lib/zitadel";
import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/resources/flows/checks";

const SCHEMA_PATH = ".zitadel/schemas/customers.json";
const FLOW_PATH = ".zitadel/flows/login.json";

/**
 * A schema-rule finding on one step of the flow.
 *
 * @param step - The step it is on, or none for a finding about the whole flow.
 * @param message - The finding's wording.
 * @returns The finding.
 */
function issueOn(step: string | undefined, message: string): FlowIssue {
  if (step === undefined) {
    return { path: FLOW_PATH, issue: { severity: "error", rule: "definition", message } };
  }
  return {
    path: FLOW_PATH,
    issue: { severity: "error", rule: "schema/fields-resolve", message, step },
  };
}

/**
 * A step that collects a password, with what it keeps and what leads to it.
 *
 * @param step - The step's name.
 * @param overrides - What differs from a step left with nothing.
 * @returns The step's use of the method.
 */
function useOf(step: string, overrides: Partial<FlowMethodUse> = {}): FlowMethodUse {
  return {
    path: FLOW_PATH,
    step,
    uses: "collects password",
    keeps: [],
    entryFor: [],
    targetedBy: [],
    staying: [],
    ...overrides,
  };
}

/**
 * The refusal for these issues and, when given, the steps that use the method.
 *
 * @param issues - The issues.
 * @param uses - The steps that use the method being disabled.
 * @returns The refusal.
 */
function refusalOf(
  issues: readonly FlowIssue[],
  uses?: readonly FlowMethodUse[],
): BrokenFlowsError {
  return new BrokenFlowsError({
    file: SCHEMA_PATH,
    heading: "A login flow would stop validating after this change:",
    hint: "Fix the steps named above.",
    issues,
    uses,
  });
}

describe("BrokenFlowsError", () => {
  it("lists each issue under the heading as the flow rules word it", () => {
    const error = refusalOf([issueOn("password", 'step "password": no such field')]);

    expect(error.message).toBe(
      [
        "A login flow would stop validating after this change:",
        `  - ${FLOW_PATH}: step "password": no such field`,
      ].join("\n"),
    );
  });

  it("carries the hint it was given", () => {
    expect(refusalOf([issueOn("password", "broken")]).hint).toBe("Fix the steps named above.");
  });

  it("names the schema and each issue in its details", () => {
    const error = refusalOf([issueOn("password", "broken")]);

    expect(error.details).toEqual({
      file: SCHEMA_PATH,
      issues: [
        { path: FLOW_PATH, rule: "schema/fields-resolve", message: "broken", step: "password" },
      ],
    });
  });

  it("leaves out the step of an issue that names none", () => {
    const error = refusalOf([issueOn(undefined, "steps: expected a list")]);

    expect(error.details).toEqual({
      file: SCHEMA_PATH,
      issues: [{ path: FLOW_PATH, rule: "definition", message: "steps: expected a list" }],
    });
  });

  it("lists a step that uses the method in place of the issue on it", () => {
    const error = refusalOf([issueOn("password", "broken")], [useOf("password")]);

    expect(error.message).not.toContain("broken");
  });

  it("still lists an issue on a step that does not use the method", () => {
    const error = refusalOf(
      [issueOn("password", "broken"), issueOn("other", "also broken")],
      [useOf("password")],
    );

    expect(error.message).toContain(`  - ${FLOW_PATH}: also broken`);
  });

  it("says what a step keeps without the method", () => {
    const error = refusalOf(
      [issueOn("password", "broken")],
      [useOf("password", { keeps: ['field "email"', "gates"] })],
    );

    expect(error.message).toContain(
      `  - ${FLOW_PATH}: step "password" collects password\n    Still has field "email", gates.`,
    );
  });

  it("says a step left with nothing is left with nothing", () => {
    const error = refusalOf([issueOn("password", "broken")], [useOf("password")]);

    expect(error.message).toContain(
      `  - ${FLOW_PATH}: step "password" collects password\n    Left with no field or sign-in method.`,
    );
  });

  it("names the purposes a step left with nothing is the entry step of", () => {
    const error = refusalOf(
      [issueOn("password", "broken")],
      [useOf("password", { entryFor: ["login", "register"] })],
    );

    expect(error.message).toContain("Entry step of purposes.login, purposes.register.");
  });

  it("names the transitions that still lead to a step left with nothing", () => {
    const staying = [
      { step: "identifier", transition: "submit" },
      { step: "register", transition: "sign_in", purpose: "login" },
    ];
    const error = refusalOf(
      [issueOn("password", "broken")],
      [useOf("password", { targetedBy: staying, staying })],
    );

    expect(error.message).toContain(
      "Targeted by identifier.submit, register.sign_in (via purposes.login).",
    );
  });

  it("does not name a transition that goes with its own step", () => {
    const error = refusalOf(
      [issueOn("password", "broken")],
      [useOf("password", { targetedBy: [{ step: "identifier", transition: "submit" }] })],
    );

    expect(error.message).not.toContain("Targeted by");
  });

  it("does not say what starts on or leads to a step that keeps something", () => {
    const error = refusalOf(
      [issueOn("password", "broken")],
      [
        useOf("password", {
          keeps: ['field "email"'],
          entryFor: ["login"],
          targetedBy: [{ step: "identifier", transition: "submit" }],
          staying: [{ step: "identifier", transition: "submit" }],
        }),
      ],
    );

    expect(error.message).not.toMatch(/Entry step of|Targeted by/);
  });

  it("describes each step that uses the method in its details", () => {
    const error = refusalOf(
      [issueOn("password", "broken")],
      [
        useOf("password", {
          keeps: ['field "email"'],
          entryFor: ["login"],
          targetedBy: [{ step: "identifier", transition: "submit" }],
        }),
      ],
    );

    expect(error.details).toMatchObject({
      file: SCHEMA_PATH,
      steps: [
        {
          path: FLOW_PATH,
          step: "password",
          keeps: ['field "email"'],
          entry_for: ["login"],
          targeted_by: [{ step: "identifier", transition: "submit" }],
        },
      ],
    });
  });

  it("has no steps in its details when no step uses a method", () => {
    expect(refusalOf([issueOn("password", "broken")]).details).not.toHaveProperty("steps");
  });
});

describe("NoSignInLeftError", () => {
  const error = new NoSignInLeftError({
    path: SCHEMA_PATH,
    schema: "customers",
    disabling: "password",
    usable: ["password"],
    alternatives: ["passkey"],
  });

  it("names the schema that would have no way to sign in", () => {
    expect(error.message).toBe(`${SCHEMA_PATH} would have no way to sign in left`);
  });

  it("names the schema, what it enabled and its alternatives in its details", () => {
    expect(error.details).toEqual({ file: SCHEMA_PATH, usable: ["password"], alternatives: ["passkey"] });
  });
});

describe("ConnectionExistsError", () => {
  it("is a conflict", () => {
    const error = new ConnectionExistsError(".zitadel/idps/google.json", googleSelection);

    expect(error).toBeInstanceOf(ConflictError);
  });

  it("says the connection file is already there", () => {
    const error = new ConnectionExistsError(".zitadel/idps/google.json", googleSelection);

    expect(error.message).toBe(".zitadel/idps/google.json already exists");
  });

  it("never offers to replace the file", () => {
    const error = new ConnectionExistsError(".zitadel/idps/google.json", googleSelection);

    expect(error.hint).not.toContain("--force");
  });

  it("names the file in its details", () => {
    const error = new ConnectionExistsError(".zitadel/idps/google.json", googleSelection);

    expect(error.details).toEqual({ file: ".zitadel/idps/google.json" });
  });

  it("keeps the provider as it was chosen", () => {
    const error = new ConnectionExistsError(".zitadel/idps/google.json", googleSelection);

    expect(error.selection).toBe(googleSelection);
  });
});
