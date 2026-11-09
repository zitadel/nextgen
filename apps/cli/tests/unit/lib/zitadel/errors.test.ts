import { describe, expect, it } from "vitest";

import {
  BrokenFlowsError,
  CONFIG_DIRECTORIES,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  NoSignInLeftError,
} from "@/lib/zitadel";
import { stepName } from "@/lib/zitadel/names";
import type { IncomingTransition } from "@/lib/zitadel/resources/flows/types";
import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";
import { googleSelection } from "@tests/helpers/idp-values";

/**
 * The schema whose change would break a flow.
 */
const SCHEMA_PATH = `${CONFIG_DIRECTORIES.schemas}/customers.json`;

/**
 * The flow the change would break.
 */
const FLOW_PATH = `${CONFIG_DIRECTORIES.flows}/login.json`;

/**
 * The Google connection's file.
 */
const GOOGLE_PATH = `${CONFIG_DIRECTORIES.connections}/google.json`;

/**
 * What the refusal tells the developer to do.
 */
const HINT = "Fix the steps named above.";

/**
 * What a schema left with no way to sign in is refused with.
 */
const NO_SIGN_IN_LEFT = {
  path: SCHEMA_PATH,
  schema: "customers",
  disabling: "password",
  usable: ["password"],
  alternatives: ["passkey"],
};

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
 * A finding on the `password` step.
 */
const BROKEN = issueOn("password", "broken");

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
    step: stepName(step),
    uses: "collects password",
    keeps: [],
    entryFor: [],
    targetedBy: [],
    staying: [],
    ...overrides,
  };
}

/**
 * The transitions that still lead to the `password` step once it is left with nothing.
 */
const STAYING: readonly IncomingTransition[] = [
  { step: stepName("identifier"), transition: "submit" },
  { step: stepName("register"), transition: "sign_in", purpose: "login" },
];

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
  const refused = {
    file: SCHEMA_PATH,
    heading: "A login flow would stop validating after this change:",
    hint: HINT,
    issues,
  };
  if (uses === undefined) {
    return new BrokenFlowsError({ ...refused, kind: "broken" });
  }
  return new BrokenFlowsError({ ...refused, kind: "method-in-use", uses });
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
    const error = refusalOf([BROKEN]);

    expect(error.hint).toBe(HINT);
  });

  it("names the schema and each issue in its details", () => {
    const error = refusalOf([BROKEN]);

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

  it("has no steps in its details when no step uses a method", () => {
    const error = refusalOf([BROKEN]);

    expect(error.details).not.toHaveProperty("steps");
  });

  describe("with steps that use the method", () => {
    it.each([
      [
        "still lists an issue on a step that does not use the method",
        [BROKEN, issueOn("other", "also broken")],
        [useOf("password")],
        `  - ${FLOW_PATH}: also broken`,
      ],
      [
        "says what a step keeps without the method",
        [BROKEN],
        [useOf("password", { keeps: ['field "email"', "gates"] })],
        `  - ${FLOW_PATH}: step "password" collects password\n    Still has field "email", gates.`,
      ],
      [
        "says a step left with nothing is left with nothing",
        [BROKEN],
        [useOf("password")],
        `  - ${FLOW_PATH}: step "password" collects password\n    Left with no field or sign-in method.`,
      ],
      [
        "names the purposes a step left with nothing is the entry step of",
        [BROKEN],
        [useOf("password", { entryFor: ["login", "register"] })],
        "Entry step of purposes.login, purposes.register.",
      ],
      [
        "names the transitions that still lead to a step left with nothing",
        [BROKEN],
        [useOf("password", { targetedBy: STAYING, staying: STAYING })],
        "Targeted by identifier.submit, register.sign_in (via purposes.login).",
      ],
    ])("%s", (_claim, issues, uses, said) => {
      const error = refusalOf(issues, uses);

      expect(error.message).toContain(said);
    });

    it.each([
      [
        "lists a step that uses the method in place of the issue on it",
        [useOf("password")],
        "broken",
      ],
      [
        "does not name a transition that goes with its own step",
        [
          useOf("password", {
            targetedBy: [{ step: stepName("identifier"), transition: "submit" }],
          }),
        ],
        "Targeted by",
      ],
      [
        "does not say what starts on or leads to a step that keeps something",
        [
          useOf("password", {
            keeps: ['field "email"'],
            entryFor: ["login"],
            targetedBy: [{ step: stepName("identifier"), transition: "submit" }],
            staying: [{ step: stepName("identifier"), transition: "submit" }],
          }),
        ],
        /Entry step of|Targeted by/,
      ],
    ])("%s", (_claim, uses, unsaid) => {
      const error = refusalOf([BROKEN], uses);

      expect(error.message).not.toMatch(unsaid);
    });

    it("describes each step that uses the method in its details", () => {
      const error = refusalOf(
        [BROKEN],
        [
          useOf("password", {
            keeps: ['field "email"'],
            entryFor: ["login"],
            targetedBy: [{ step: stepName("identifier"), transition: "submit" }],
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
            targeted_by: [{ step: stepName("identifier"), transition: "submit" }],
          },
        ],
      });
    });
  });
});

describe("NoSignInLeftError", () => {
  it("names the schema that would have no way to sign in", () => {
    const error = new NoSignInLeftError(NO_SIGN_IN_LEFT);

    expect(error.message).toBe(`${SCHEMA_PATH} would have no way to sign in left`);
  });

  it("names the schema, what it enabled and its alternatives in its details", () => {
    const error = new NoSignInLeftError(NO_SIGN_IN_LEFT);

    expect(error.details).toEqual({
      file: SCHEMA_PATH,
      usable: ["password"],
      alternatives: ["passkey"],
    });
  });
});

describe("ConnectionExistsError", () => {
  it("is a conflict", () => {
    const error = new ConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error).toBeInstanceOf(ConflictError);
  });

  it("says the connection file is already there", () => {
    const error = new ConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.message).toBe(`${GOOGLE_PATH} already exists`);
  });

  it("never offers to replace the file", () => {
    const error = new ConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.hint).not.toContain("--force");
  });

  it("names the file in its details", () => {
    const error = new ConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.details).toEqual({ file: GOOGLE_PATH });
  });

  it("keeps the provider as it was chosen", () => {
    const error = new ConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.selection).toBe(googleSelection);
  });
});

describe("FileExistsError", () => {
  it("is a conflict", () => {
    const error = new FileExistsError(GOOGLE_PATH);

    expect(error).toBeInstanceOf(ConflictError);
  });

  it("names no flag, as not every command that writes a file has one", () => {
    const error = new FileExistsError(GOOGLE_PATH);

    expect(error.hint).not.toContain("--");
  });

  it("names the file in its details", () => {
    const error = new FileExistsError(GOOGLE_PATH);

    expect(error.details).toEqual({ file: GOOGLE_PATH });
  });
});
