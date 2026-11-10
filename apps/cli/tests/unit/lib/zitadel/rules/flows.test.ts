import { describe, expect, it } from "vitest";

import { BrokenFlowsError, type JsonObject } from "@/lib/zitadel";
import { assertFlowsIntact, assertMethodUnused, FLOW_RULES } from "@/lib/zitadel/rules/flows";
import { aConfig, authMethods, aUserSchema } from "@tests/helpers/config";
import {
  aFlowOffering,
  aMethodEdit,
  aMethodEditRewritingFlow,
  HUMAN_USER,
} from "@tests/helpers/schemas";
import { withStepChanged } from "@tests/helpers/connections";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The file name of the schema in these tests.
 */
const SCHEMA_FILE = "customers.json";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The file name of the flow in these tests.
 */
const FLOW_FILE = "login.json";

/**
 * Where the flow in these tests sits.
 */
const FLOW_PATH = `.zitadel/flows/${FLOW_FILE}`;

/**
 * The schema with password and passkey both on.
 */
const BOTH_METHODS = aUserSchema({ "x-auth-methods": authMethods("password", "passkey") });

/**
 * The schema with only password on.
 */
const PASSWORD_ONLY = aUserSchema({ "x-auth-methods": authMethods("password") });

/**
 * The shipped password flow, cut to the steps the validator needs.
 */
const PASSWORD_FLOW = {
  name: "default-login",
  status: "active",
  user_schema: HUMAN_USER,
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

/**
 * A flow whose login entry offers only a passkey.
 */
const PASSKEY_FLOW = {
  ...PASSWORD_FLOW,
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

/**
 * The password flow with a purpose whose entry step does not exist: a
 * structural error, which stops the validator before the schema rules would
 * notice the password step.
 */
const STRUCTURALLY_BROKEN_FLOW: JsonObject = {
  ...PASSWORD_FLOW,
  purposes: { login: "identifier", register: "missing" },
};

/**
 * The password flow with a reserved purpose, which is only a warning: the flow
 * works, so a change to it is still worth checking.
 */
const WARNED_FLOW = {
  ...PASSWORD_FLOW,
  purposes: { login: "identifier", recovery: "identifier" },
};

/**
 * The password flow whose password step also collects the email.
 */
const PASSWORD_BESIDE_EMAIL_FLOW: JsonObject = withStepChanged(PASSWORD_FLOW, "password", {
  fields: ["email", "x-auth-methods#password"],
});

/**
 * The passkey-first preset, cut to the steps and transitions that matter here.
 */
const PASSKEY_FIRST_FLOW = {
  name: "passkey-first",
  status: "active",
  user_schema: HUMAN_USER,
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

/**
 * A flow whose two password steps each lead to the next.
 */
const CHAINED_PASSWORD_FLOW = {
  name: "chained",
  status: "active",
  user_schema: HUMAN_USER,
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

/**
 * What a flow names to pin a schema the project does not keep locally.
 */
const OTHER_SCHEMA = "staff";

describe("assertFlowsIntact", () => {
  it("names the step that still collects a disabled password", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      details: { file: SCHEMA_PATH, issues: [{ path: FLOW_PATH, step: "password" }] },
    });
  });

  it("says a flow would stop validating", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      message: expect.stringContaining("A login flow would stop validating after this change:"),
      hint: "Fix the steps named above, then run the command again.",
    });
  });

  it("names the step that still offers a disabled passkey", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("passkey") }) },
      flows: { [FLOW_FILE]: PASSKEY_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      details: { issues: [{ rule: "schema/passkey-actions", step: "passkey-first" }] },
    });
  });

  it("finds nothing when the flow never used the method", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: BOTH_METHODS },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeUndefined();
  });

  it("ignores schema errors the flow already had", () => {
    const methods = { password: { enabled: false }, passkey: { enabled: true } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeUndefined();
  });

  it("ignores a flow that runs against another schema", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: { ...PASSWORD_FLOW, user_schema: OTHER_SCHEMA } },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeUndefined();
  });

  it("still checks a flow whose only findings are warnings", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: WARNED_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({ details: { issues: [{ step: "password" }] } });
  });

  it("refuses a structurally broken flow as unchecked rather than unaffected", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: STRUCTURALLY_BROKEN_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

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

  it("judges a flow the change also rewrites against its body before the change", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: BOTH_METHODS },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEditRewritingFlow(config, "passkey", false, {
      path: FLOW_PATH,
      body: withStepChanged(PASSWORD_FLOW, "password", {
        fields: ["x-auth-methods#password", "nickname"],
      }),
    });

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({ details: { issues: [{ path: FLOW_PATH, step: "password" }] } });
  });

  it("breaks nothing with an edit that writes nothing, even beside a broken flow", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: STRUCTURALLY_BROKEN_FLOW },
    });
    const edit = aMethodEdit(config, "password", true);

    const error = thrownBy(() => {
      assertFlowsIntact(edit);
    });

    expect(error).toBeUndefined();
  });
});

describe("assertMethodUnused", () => {
  describe("when steps still offer the passkey being turned off", () => {
    it("names the method and the schema it is disabled in", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: BOTH_METHODS },
        flows: { [FLOW_FILE]: PASSKEY_FIRST_FLOW },
      });
      const edit = aMethodEdit(config, "passkey", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "passkey");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          `Disabling passkey in ${SCHEMA_PATH} would break a login flow that still uses it:`,
        ),
      });
    });

    it("lists each step that uses the method, with what it keeps", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: BOTH_METHODS },
        flows: { [FLOW_FILE]: PASSKEY_FIRST_FLOW },
      });
      const edit = aMethodEdit(config, "passkey", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "passkey");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        details: {
          steps: [
            { step: "passkey-first", keeps: [], entry_for: ["login"] },
            { step: "identifier", keeps: ['field "email"'], entry_for: [] },
          ],
        },
      });
    });

    it.each([
      "point the purposes key it is the entry step of at another step",
      "one marked via purposes.<key> follows that key instead",
      "remove its passkey actions and their transitions",
    ])("says %s in its hint", (advice) => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: BOTH_METHODS },
        flows: { [FLOW_FILE]: PASSKEY_FIRST_FLOW },
      });
      const edit = aMethodEdit(config, "passkey", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "passkey");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({ hint: expect.stringContaining(advice) });
    });
  });

  describe("when steps still collect the password being turned off", () => {
    it.each([
      "remove its x-auth-methods#password field",
      "Delete a step left with no field or sign-in method: retarget the transitions listed for it.",
    ])("says %s in its hint", (advice) => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: BOTH_METHODS },
        flows: { [FLOW_FILE]: PASSKEY_FIRST_FLOW },
      });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({ hint: expect.stringContaining(advice) });
    });

    it("does not ask to delete a step that keeps something", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: BOTH_METHODS },
        flows: { [FLOW_FILE]: PASSWORD_BESIDE_EMAIL_FLOW },
      });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({ hint: expect.not.stringContaining("Delete a step") });
    });
  });

  describe("when a step left with nothing leads to another", () => {
    it("leaves its transition out of the message", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
        flows: { [FLOW_FILE]: CHAINED_PASSWORD_FLOW },
      });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        message: expect.not.stringContaining("Targeted by first.submit"),
      });
    });

    it("still lists that transition in the details", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
        flows: { [FLOW_FILE]: CHAINED_PASSWORD_FLOW },
      });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        details: {
          steps: [
            { step: "first", targeted_by: [] },
            { step: "second", targeted_by: [{ step: "first", transition: "submit" }] },
          ],
        },
      });
    });
  });

  describe("when two flows share a schema and a step name", () => {
    /**
     * Two flows on one schema, both with steps `first` and `second`: in the
     * first both are left empty by turning the password off, in the second
     * only `second` is.
     */
    const SHARING_FLOWS = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: {
        "a.json": CHAINED_PASSWORD_FLOW,
        "b.json": {
          ...withStepChanged(CHAINED_PASSWORD_FLOW, "first", {
            fields: ["email", "x-auth-methods#password"],
          }),
          name: "other",
        },
      },
    });

    it("keeps a transition into a step when the step leading on keeps a field in that flow", () => {
      const edit = aMethodEdit(SHARING_FLOWS, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /b\.json: step "second"[^\n]*\n\s+Left with no field or sign-in method\. Targeted by first\.submit\./,
        ),
      });
    });

    it("leaves a transition out when the step leading on is left empty in that flow", () => {
      const edit = aMethodEdit(SHARING_FLOWS, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /a\.json: step "second"[^\n]*\n\s+Left with no field or sign-in method\.(\n|$)/,
        ),
      });
    });
  });

  describe("when the only step left with nothing is an entry nothing leads to", () => {
    it("asks to repoint its purpose and not to retarget anything", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
        flows: { [FLOW_FILE]: CHAINED_PASSWORD_FLOW },
      });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        assertMethodUnused(edit, "password");
      });

      expect(error).toBeInstanceOf(BrokenFlowsError);
      expect(error).toMatchObject({
        hint: expect.stringContaining(
          "Delete a step left with no field or sign-in method: point the purposes key it is the entry step of at another step.",
        ),
      });
      expect(error).toMatchObject({ hint: expect.not.stringContaining("retarget") });
    });
  });

  it("finds nothing when no flow uses the method", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: BOTH_METHODS },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      assertMethodUnused(edit, "passkey");
    });

    expect(error).toBeUndefined();
  });

  it("refuses a flow it cannot check before naming any step", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
      flows: { [FLOW_FILE]: STRUCTURALLY_BROKEN_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertMethodUnused(edit, "password");
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      message: expect.stringContaining(
        "A login flow has errors, so it cannot be checked against the changed schema:",
      ),
    });
  });

  it("breaks nothing with an edit that writes nothing", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": { password: { enabled: false } } }),
      },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      assertMethodUnused(edit, "password");
    });

    expect(error).toBeUndefined();
  });
});

describe("FLOW_RULES", () => {
  describe("with the server's flow rules", () => {
    it("holds a flow to the schema it pins", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("passkey") }) },
        flows: { [FLOW_FILE]: PASSWORD_FLOW },
      });

      const issues = FLOW_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ severity: "error", file: FLOW_PATH }),
      );
    });

    it("finds nothing in a flow that agrees with the schema it pins", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: PASSWORD_ONLY },
        flows: { [FLOW_FILE]: PASSWORD_FLOW },
      });

      const issues = FLOW_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toEqual([]);
    });
  });

  describe("with flow/unpinned-schema", () => {
    it("warns about a flow offering a provider that pins no local schema", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aUserSchema() },
        flows: { [FLOW_FILE]: aFlowOffering(["google"], OTHER_SCHEMA) },
      });

      const issues = FLOW_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual({
        severity: "warning",
        rule: "flow/unpinned-schema",
        file: FLOW_PATH,
        message:
          "could not tell which local schema this flow pins, so its provider rules were not checked against a schema",
      });
    });

    it.each([
      ["pins a local schema", aFlowOffering(["google"])],
      ["offers no provider", aFlowOffering([], OTHER_SCHEMA)],
    ])("stays quiet about a flow that %s", (_case, flow) => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aUserSchema() },
        flows: { [FLOW_FILE]: flow },
      });

      const issues = FLOW_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).not.toContainEqual(expect.objectContaining({ rule: "flow/unpinned-schema" }));
    });
  });
});
