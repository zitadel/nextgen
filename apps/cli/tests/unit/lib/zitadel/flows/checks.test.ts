import { describe, expect, it } from "vitest";

import { BrokenFlowsError, ZitadelConfig } from "@/lib/zitadel";
import { assertFlowsIntact, assertMethodUnused } from "@/lib/zitadel/flows/checks";
import type { JsonObject } from "@/lib/zitadel/types";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/schemas/types";
import { thrownBy } from "@tests/helpers/thrown-value";

const SCHEMA_PATH = ".zitadel/schemas/customers.json";
const SCHEMA_ID = "https://schemas.test.invalid/default-human-user.json";

/** A user schema that enables these methods. */
function schemaBody(methods: JsonObject): JsonObject {
  return {
    $id: SCHEMA_ID,
    type: "object",
    "x-identifier": "email",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
    "x-auth-methods": methods,
  };
}

/** The configuration with the schema and these flows, each at `.zitadel/flows/<name>.json`. */
function configOf(methods: JsonObject, flows: readonly JsonObject[]): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [{ path: SCHEMA_PATH, body: schemaBody(methods) }],
    flows: flows.map((body, index) => {
      return { path: `.zitadel/flows/flow-${index}.json`, body };
    }),
    connections: [],
    policies: [],
    branding: [],
  });
}

/** The edit that switches a method of the schema on or off. */
function editOf(config: ZitadelConfig, method: ToggleableMethod, enabled: boolean): SchemaEdit {
  const original = config.schemas.all[0];
  if (original === undefined) {
    throw new Error("the configuration has no schema");
  }
  const edited = original.withMethod(method, enabled);
  return { before: config, after: config.with(edited), original, edited };
}

/** The details of the refusal an edit's flow check throws. */
function refusalDetails(edit: SchemaEdit): unknown {
  const error = thrownBy(() => {
    assertFlowsIntact(edit);
  });
  expect(error).toBeInstanceOf(BrokenFlowsError);
  return (error as BrokenFlowsError).details;
}

/** The shipped password flow, cut to the steps the validator needs. */
const passwordFlow = {
  name: "default-login",
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "password" } },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

/** A flow whose login entry offers only a passkey. */
const passkeyFlow = {
  ...passwordFlow,
  purposes: { login: "passkey-first" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      actions: [{ name: "passkey", kind: "passkey", primary: true }],
      transitions: { passkey: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

/** The password flow with the password step's `fields` a string, not a list. */
const malformedFlow = {
  ...passwordFlow,
  steps: [
    passwordFlow.steps[0],
    { ...passwordFlow.steps[1], fields: "x-auth-methods#password" },
    passwordFlow.steps[2],
  ],
};

/** The password flow with a purpose whose entry step does not exist. */
const structurallyBrokenFlow = {
  ...passwordFlow,
  purposes: { login: "identifier", register: "missing" },
};

describe("assertFlowsIntact", () => {
  it("names the step that still collects a disabled password", () => {
    const config = configOf({ password: { enabled: true } }, [passwordFlow]);
    const edit = editOf(config, "password", false);

    expect(refusalDetails(edit)).toMatchObject({
      file: SCHEMA_PATH,
      issues: [{ path: ".zitadel/flows/flow-0.json", step: "password" }],
    });
  });

  it("says a flow would stop validating", () => {
    const config = configOf({ password: { enabled: true } }, [passwordFlow]);
    const edit = editOf(config, "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toMatchObject({
      message: expect.stringContaining("A login flow would stop validating after this change:"),
      hint: "Fix the steps named above, then run the command again.",
    });
  });

  it("names the step that still offers a disabled passkey", () => {
    const config = configOf({ passkey: { enabled: true } }, [passkeyFlow]);
    const edit = editOf(config, "passkey", false);

    expect(refusalDetails(edit)).toMatchObject({
      issues: [{ rule: "schema/passkey-actions", step: "passkey-first" }],
    });
  });

  it("finds nothing when the flow never used the method", () => {
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [
      passwordFlow,
    ]);

    expect(() => {
      assertFlowsIntact(editOf(config, "passkey", false));
    }).not.toThrow();
  });

  it("ignores schema errors the flow already had", () => {
    // Password is already off, so the password step is already an error.
    const config = configOf({ password: { enabled: false }, passkey: { enabled: true } }, [
      passwordFlow,
    ]);

    expect(() => {
      assertFlowsIntact(editOf(config, "passkey", false));
    }).not.toThrow();
  });

  it("ignores a flow that runs against another schema", () => {
    const config = configOf({ password: { enabled: true } }, [
      { ...passwordFlow, user_schema: "https://schemas.test.invalid/staff.json" },
    ]);

    expect(() => {
      assertFlowsIntact(editOf(config, "password", false));
    }).not.toThrow();
  });

  it("still checks a flow whose only findings are warnings", () => {
    // A reserved purpose is a warning: the flow works, so the change to it is
    // still worth checking.
    const warned = { ...passwordFlow, purposes: { login: "identifier", recovery: "identifier" } };
    const edit = editOf(configOf({ password: { enabled: true } }, [warned]), "password", false);

    expect(refusalDetails(edit)).toMatchObject({ issues: [{ step: "password" }] });
  });

  it.each([
    // A string where `fields` should be a list reads as no fields to the
    // semantic validator, which would hide the password step.
    ["a malformed flow file", malformedFlow],
    // A structural error stops the validator before the schema rules, so the
    // password step would otherwise go unnoticed.
    ["a structurally broken flow", structurallyBrokenFlow],
  ])("refuses %s as unchecked rather than unaffected", (_, flow) => {
    const edit = editOf(configOf({ password: { enabled: true } }, [flow]), "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      message: expect.stringContaining(
        "A login flow has errors, so it cannot be checked against the changed schema:",
      ),
      hint: expect.stringContaining("zitadel deploy --dry-run"),
    });
  });

  it("breaks nothing with an edit that writes nothing, even beside a broken flow", () => {
    const config = configOf({ password: { enabled: true } }, [structurallyBrokenFlow]);

    expect(() => {
      assertFlowsIntact(editOf(config, "password", true));
    }).not.toThrow();
  });
});

/** The passkey-first preset, cut to the steps and transitions that matter here. */
const passkeyFirstFlow = {
  name: "passkey-first",
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "passkey-first", register: "register" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      actions: [
        { name: "passkey", kind: "passkey" },
        { name: "email_fallback", kind: "navigate" },
      ],
      transitions: { passkey: { target: "done" }, email_fallback: { target: "identifier" } },
    },
    {
      name: "identifier",
      fields: ["email"],
      actions: [
        { name: "submit", kind: "submit" },
        { name: "passkey", kind: "passkey" },
      ],
      transitions: { submit: { target: "password" }, passkey: { target: "done" } },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit" }],
      transitions: { submit: { target: "done" } },
    },
    {
      name: "register",
      fields: ["email"],
      actions: [{ name: "sign_in", kind: "navigate" }],
      transitions: { sign_in: { purpose: "login" } },
    },
    { name: "done", complete: "show" },
  ],
};

/** A flow whose two password steps each lead to the next. */
const chainedPasswordFlow = {
  name: "chained",
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "first" },
  steps: [
    {
      name: "first",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit" }],
      transitions: { submit: { target: "second" } },
    },
    {
      name: "second",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit" }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

describe("assertMethodUnused", () => {
  const passkeyOff = (): SchemaEdit => {
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [
      passkeyFirstFlow,
    ]);
    return editOf(config, "passkey", false);
  };

  const refusalOf = (edit: SchemaEdit, method: ToggleableMethod): BrokenFlowsError => {
    const error = thrownBy(() => {
      assertMethodUnused(edit, method);
    });
    expect(error).toBeInstanceOf(BrokenFlowsError);
    return error as BrokenFlowsError;
  };

  it("names the method and the schema it is disabled in", () => {
    expect(refusalOf(passkeyOff(), "passkey").message).toContain(
      `Disabling passkey in ${SCHEMA_PATH} would break a login flow that still uses it:`,
    );
  });

  it("lists each step that uses the method, with what it keeps", () => {
    expect(refusalOf(passkeyOff(), "passkey").details).toMatchObject({
      steps: [
        { step: "passkey-first", keeps: [], entry_for: ["login"] },
        { step: "identifier", keeps: ['field "email"'], entry_for: [] },
      ],
    });
  });

  it("asks to point the purpose at another step when its entry step is left with nothing", () => {
    expect(refusalOf(passkeyOff(), "passkey").hint).toContain(
      "point the purposes key it is the entry step of at another step",
    );
  });

  it("says a transition that follows a purpose follows that key instead", () => {
    expect(refusalOf(passkeyOff(), "passkey").hint).toContain(
      "one marked via purposes.<key> follows that key instead",
    );
  });

  it("names what to remove from each step for a passkey", () => {
    expect(refusalOf(passkeyOff(), "passkey").hint).toContain(
      "remove its passkey actions and their transitions",
    );
  });

  it("names what to remove from each step for a password", () => {
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [
      passkeyFirstFlow,
    ]);

    expect(refusalOf(editOf(config, "password", false), "password").hint).toContain(
      "remove its x-auth-methods#password field",
    );
  });

  it("asks to delete only the steps left with nothing", () => {
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [
      passkeyFirstFlow,
    ]);

    expect(refusalOf(editOf(config, "password", false), "password").hint).toContain(
      "Delete a step left with no field or sign-in method: retarget the transitions listed for it.",
    );
  });

  it("does not ask to delete a step that keeps something", () => {
    const flow = {
      ...passwordFlow,
      steps: [
        passwordFlow.steps[0],
        { ...passwordFlow.steps[1], fields: ["email", "x-auth-methods#password"] },
        passwordFlow.steps[2],
      ],
    };
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [flow]);

    expect(refusalOf(editOf(config, "password", false), "password").hint).not.toContain(
      "Delete a step",
    );
  });

  it("leaves out a transition from a step that is itself left with nothing", () => {
    const config = configOf({ password: { enabled: true } }, [chainedPasswordFlow]);

    const message = refusalOf(editOf(config, "password", false), "password").message;

    expect(message).not.toContain("Targeted by first.submit");
  });

  it("still lists that transition in the details", () => {
    const config = configOf({ password: { enabled: true } }, [chainedPasswordFlow]);

    expect(refusalOf(editOf(config, "password", false), "password").details).toMatchObject({
      steps: [
        { step: "first", targeted_by: [] },
        { step: "second", targeted_by: [{ step: "first", transition: "submit" }] },
      ],
    });
  });

  it("finds nothing when no flow uses the method", () => {
    const config = configOf({ password: { enabled: true }, passkey: { enabled: true } }, [
      passwordFlow,
    ]);

    expect(() => {
      assertMethodUnused(editOf(config, "passkey", false), "passkey");
    }).not.toThrow();
  });

  it("refuses a flow it cannot check before naming any step", () => {
    const config = configOf({ password: { enabled: true } }, [malformedFlow]);

    expect(refusalOf(editOf(config, "password", false), "password").message).toContain(
      "A login flow has errors, so it cannot be checked against the changed schema:",
    );
  });

  it("breaks nothing with an edit that writes nothing", () => {
    const config = configOf({ password: { enabled: false } }, [passwordFlow]);

    expect(() => {
      assertMethodUnused(editOf(config, "password", false), "password");
    }).not.toThrow();
  });
});
