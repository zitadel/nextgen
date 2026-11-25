import { describe, expect, it } from "vitest";

import {
  ZitadelConfigError,
  ZitadelConfigResourceClashError,
  ZitadelConfigResourceMissingError,
  ZitadelConfigSchemaAmbiguousError,
  ZitadelConfigSchemaMissingError,
  ZitadelConfigFileBrokenError,
  ZitadelConfigEditBreaksFlowsError,
  ZitadelConfigEditMethodInUseError,
  CONFIG_DIRECTORIES,
  ZitadelConfigConnectionExistsError,
  ZitadelConfigFileExistsError,
  ZitadelConfigEditLockoutError,
  ZitadelConfigFileUnreadableError,
  ZitadelConfigInternalError,
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
): ZitadelConfigError {
  const heading = "A login flow would stop validating after this change:";
  if (uses === undefined) {
    return new ZitadelConfigEditBreaksFlowsError({
      heading,
      issues,
    });
  }
  return new ZitadelConfigEditMethodInUseError({
    heading,
    issues,
    uses,
  });
}

describe("ZitadelConfigEditBreaksFlowsError", () => {
  it("lists each issue under the heading as the flow rules word it", () => {
    const error = refusalOf([issueOn("password", 'step "password": no such field')]);

    expect(error.message).toBe(
      [
        "A login flow would stop validating after this change:",
        `  - ${FLOW_PATH}: step "password": no such field`,
      ].join("\n"),
    );
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
  });
});

describe("ZitadelConfigEditLockoutError", () => {
  it("names the schema that would have no way to sign in", () => {
    const error = new ZitadelConfigEditLockoutError(NO_SIGN_IN_LEFT);

    expect(error.message).toBe(`${SCHEMA_PATH} would have no way to sign in left`);
  });

  it("keeps what it enabled and its alternatives", () => {
    const error = new ZitadelConfigEditLockoutError(NO_SIGN_IN_LEFT);

    expect(error).toMatchObject({
      usable: ["password"],
      alternatives: ["passkey"],
    });
  });
});

describe("ZitadelConfigFileBrokenError", () => {
  it("counts a file once however many problems it has", () => {
    const error = new ZitadelConfigFileBrokenError([
      { path: ".zitadel/idps/acme.json", problem: "protocol is missing" },
      { path: ".zitadel/idps/acme.json", problem: "name is missing" },
    ]);

    expect(error.message.split("\n")[0]).toBe("1 configuration file is not valid:");
  });

  it("counts each file that has a problem", () => {
    const error = new ZitadelConfigFileBrokenError([
      { path: ".zitadel/idps/acme.json", problem: "protocol is missing" },
      { path: ".zitadel/idps/other.json", problem: "protocol is missing" },
    ]);

    expect(error.message.split("\n")[0]).toBe("2 configuration files are not valid:");
  });

  it("lists every problem, one to a line", () => {
    const error = new ZitadelConfigFileBrokenError([
      { path: ".zitadel/idps/acme.json", problem: "protocol is missing" },
      { path: ".zitadel/idps/acme.json", problem: "name is missing" },
    ]);

    expect(error.message.split("\n").slice(1)).toEqual([
      "  - .zitadel/idps/acme.json: protocol is missing",
      "  - .zitadel/idps/acme.json: name is missing",
    ]);
  });
});

describe("ZitadelConfigConnectionExistsError", () => {
  it("is a conflict", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error).toMatchObject({
      category: "conflict",
    });
  });

  it("says the connection file is already there", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.message).toBe(`${GOOGLE_PATH} already exists`);
  });

  it("keeps the provider as it was chosen", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.selection).toBe(googleSelection);
  });
});

describe("ZitadelConfigFileExistsError", () => {
  it("is a conflict", () => {
    const error = new ZitadelConfigFileExistsError(GOOGLE_PATH);

    expect(error).toMatchObject({
      category: "conflict",
    });
  });

  it("keeps the path that is already taken", () => {
    const error = new ZitadelConfigFileExistsError(GOOGLE_PATH);

    expect(error.path).toBe(GOOGLE_PATH);
  });
});

describe("ZitadelConfigFileUnreadableError", () => {
  it("is a denied failure when the permission is refused", () => {
    expect(new ZitadelConfigFileUnreadableError("x.json cannot be read")).toMatchObject({
      category: "denied",
      code: "E_AUTH",
    });
  });
});

describe("ZitadelConfigInternalError", () => {
  it("is an internal failure", () => {
    expect(new ZitadelConfigInternalError("not an object")).toMatchObject({
      category: "fault",
    });
  });
});

describe("ZitadelConfigError", () => {
  it("is a validation failure that carries the cause it was given", () => {
    const cause = new Error("root");
    const error = new ZitadelConfigError("boom", cause);

    expect(error).toMatchObject({
      name: "ZitadelConfigError",
      category: "invalid",
      retryable: false,
      code: "E_VALIDATION",
      cause,
    });
  });
});

describe("ZitadelConfigEditMethodInUseError", () => {
  it("is a validation failure that is not an edit that breaks flows", () => {
    const error = new ZitadelConfigEditMethodInUseError({
      heading: "Disabling passkey would break a login flow that still uses it:",
      issues: [],
      uses: [],
    });

    expect(error).not.toBeInstanceOf(ZitadelConfigEditBreaksFlowsError);
    expect(error).toMatchObject({
      category: "invalid",
      code: "E_VALIDATION",
    });
  });
});

describe("ZitadelConfigResourceClashError", () => {
  it("is a conflict", () => {
    expect(new ZitadelConfigResourceClashError("two with one slug")).toMatchObject({
      category: "conflict",
      code: "E_CONFLICT",
    });
  });
});

describe("ZitadelConfigResourceMissingError", () => {
  it("is a missing failure", () => {
    expect(new ZitadelConfigResourceMissingError("no such connection")).toMatchObject({
      category: "missing",
      code: "E_NOT_FOUND",
    });
  });
});

describe("ZitadelConfigSchemaMissingError", () => {
  it("is a missing failure that says no schema is named so", () => {
    const error = new ZitadelConfigSchemaMissingError("employees", []);

    expect(error).toMatchObject({
      category: "missing",
      code: "E_NOT_FOUND",
      message: "There is no user schema under .zitadel/schemas",
      known: [],
    });
  });
});

describe("ZitadelConfigSchemaAmbiguousError", () => {
  it("is a validation failure that names the name asked for", () => {
    const error = new ZitadelConfigSchemaAmbiguousError("customers", []);

    expect(error).toMatchObject({
      category: "invalid",
      code: "E_VALIDATION",
      message: "More than one user schema is named customers",
      candidates: [],
    });
  });
});
