import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema, getDefaultLoginFlow } from "./defaults.js";
import {
  FLOW_PURPOSES,
  FLOW_VALIDATION_RULES,
  PURPOSE_FLIP_TARGETS,
  RESERVED_OUTCOMES,
  validateFlowDefinition,
  type FlowValidationIssue,
} from "./validate.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const schema = getDefaultHumanUserSchema() as unknown as Record<string, unknown>;

/** Mutable view over a fixture step; `step()` asserts presence. */
type TestStep = {
  name: string;
  fields: string[];
  actions: Array<{ name: string; kind: string; primary?: boolean; text_key?: string }>;
  transitions: Record<string, { target: string; action?: string; purpose?: string }>;
  sso_providers?: Array<Record<string, string>>;
  on_success?: string;
  complete?: string;
};

type TestFlow = {
  name: string;
  status: string;
  user_schema: string;
  purposes: Record<string, string>;
  steps: Array<Partial<TestStep> & { name: string }>;
};

/** Deep-cloned default login flow; mutate freely per test. */
function flow(): TestFlow {
  return structuredClone(getDefaultLoginFlow()) as unknown as TestFlow;
}

function step(def: TestFlow, name: string): TestStep {
  const found = def.steps.find((s) => s.name === name);
  if (!found) throw new Error(`fixture step ${name} missing`);
  return found as TestStep;
}

function errors(issues: FlowValidationIssue[]): FlowValidationIssue[] {
  return issues.filter((i) => i.severity === "error");
}

function warnings(issues: FlowValidationIssue[]): FlowValidationIssue[] {
  return issues.filter((i) => i.severity === "warning");
}

function messages(issues: FlowValidationIssue[]): string[] {
  return issues.map((i) => i.message);
}

// ── positives ────────────────────────────────────────────────────────────────

describe("validateFlowDefinition — valid flows", () => {
  it("accepts the default login flow against the default schema", () => {
    expect(validateFlowDefinition(flow(), schema)).toEqual([]);
  });

  it("accepts the default flow without a schema (flow-local rules only)", () => {
    expect(validateFlowDefinition(flow())).toEqual([]);
  });

  it("accepts a login-only flow without user_not_found (no register purpose)", () => {
    const def = flow();
    def.purposes = { login: "identifier" };
    delete step(def, "identifier").transitions.user_not_found;
    // A login-only flow has no register purpose to switch to: drop the
    // default's purpose-switch navigation along with the register steps.
    delete step(def, "identifier").transitions.register;
    step(def, "identifier").actions = step(def, "identifier").actions.filter(
      (a) => a.name !== "register",
    );
    // register/register-password become unreachable; drop them.
    def.steps = def.steps.filter((s) =>
      ["identifier", "password", "done"].includes(s.name),
    );
    // The default schema requires email, still collected on identifier.
    expect(validateFlowDefinition(def, schema)).toEqual([]);
  });

  it("accepts cross-flow switch/pivot transitions without local targets", () => {
    const def = flow();
    step(def, "password").transitions.recover = {
      target: "recovery-flow",
      action: "pivot",
    };
    step(def, "password").actions.push({ name: "recover", kind: "navigate" });
    expect(validateFlowDefinition(def, schema)).toEqual([]);
  });

  it("accepts cycles that can reach a terminal step", () => {
    const def = flow();
    // password → identifier → password is a cycle; both reach done.
    step(def, "password").transitions.back_to_identifier = { target: "identifier" };
    step(def, "password").actions.push({ name: "back_to_identifier", kind: "navigate" });
    expect(validateFlowDefinition(def, schema)).toEqual([]);
  });
});

// ── phase 1/2: step names + definition ───────────────────────────────────────

describe("step-names / definition", () => {
  it("rejects duplicate step names", () => {
    const def = flow();
    def.steps.push(structuredClone(step(def, "password")));
    const issues = validateFlowDefinition(def);
    expect(messages(issues)).toContain('duplicate step name "password"');
  });

  it("rejects a flow with no purposes", () => {
    const def = flow();
    def.purposes = {};
    expect(messages(validateFlowDefinition(def))).toContain("no purposes defined");
  });

  it("rejects an invalid purpose name", () => {
    const def = flow();
    def.purposes.signup = "register";
    expect(messages(validateFlowDefinition(def))).toContain("'signup' is not a valid purpose");
  });

  it("rejects an empty entry step", () => {
    const def = flow();
    def.purposes.login = "";
    expect(messages(validateFlowDefinition(def))).toContain(
      "initial step for purpose 'login' is empty",
    );
  });

  it("rejects an entry step that is not a step", () => {
    const def = flow();
    def.purposes.login = "start";
    expect(messages(validateFlowDefinition(def))).toContain(
      'purpose "login" targets unknown entry-point step "start"',
    );
  });
});

// ── phase 3: steps ───────────────────────────────────────────────────────────

describe("steps", () => {
  it("rejects a terminal step that also declares capabilities", () => {
    const def = flow();
    step(def, "done").fields = ["email"];
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "done" is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers',
    );
  });

  it("rejects empty and duplicate field entries", () => {
    const def = flow();
    step(def, "identifier").fields = ["", "email", "email"];
    const msgs = messages(validateFlowDefinition(def));
    expect(msgs).toContain('step "identifier": field entry is empty');
    expect(msgs).toContain('step "identifier": duplicate field "email"');
  });

  it("rejects unnamed, duplicate, kindless, and reserved actions", () => {
    const def = flow();
    const s = step(def, "identifier");
    s.actions.push({ name: "", kind: "submit" });
    s.actions.push({ name: "submit", kind: "submit" });
    s.actions.push({ name: "extra", kind: "" });
    s.transitions.extra = { target: "done" };
    const msgs = messages(validateFlowDefinition(def));
    expect(msgs).toContain('step "identifier": action has empty name');
    expect(msgs).toContain('step "identifier": duplicate action "submit"');
    expect(msgs).toContain('step "identifier": action "extra" has no kind');
  });

  it("rejects a declared back action by kind and by name", () => {
    const def = flow();
    const s = step(def, "identifier");
    s.actions.push({ name: "rewind", kind: "back" });
    s.transitions.rewind = { target: "done" };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": action "rewind" has kind=back, which is engine-injected and cannot be declared',
    );

    const def2 = flow();
    const s2 = step(def2, "identifier");
    s2.actions.push({ name: "back", kind: "navigate" });
    s2.transitions.back = { target: "done" };
    expect(messages(validateFlowDefinition(def2))).toContain(
      'step "identifier": action name "back" is reserved for engine-injected back navigation',
    );
  });

  it("rejects a non-terminal step that does nothing", () => {
    const def = flow();
    def.steps.push({ name: "idle", transitions: { user_not_found: { target: "done" } } });
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "idle" is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback',
    );
  });

  it("rejects sso_providers without transitions.callback", () => {
    const def = flow();
    const s = step(def, "identifier");
    s.sso_providers = [{ id: "idp", name: "IdP", template: "generic" }];
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": has sso_providers but is missing transitions.callback',
    );
  });

  it("rejects an action without a matching transition", () => {
    const def = flow();
    delete step(def, "identifier").transitions.passkey;
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": action "passkey" has no matching transition',
    );
  });

  it("rejects a transition key that is neither action nor reserved outcome", () => {
    const def = flow();
    step(def, "identifier").transitions.jump = { target: "done" };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": transition key "jump" is not an action name or reserved outcome (user_not_found, user_already_exists, callback)',
    );
  });

  it("collects issues across independent steps", () => {
    const def = flow();
    step(def, "identifier").transitions.jump = { target: "done" };
    step(def, "password").transitions.hop = { target: "done" };
    expect(errors(validateFlowDefinition(def))).toHaveLength(2);
  });
});

// ── phase 4: graph / cycles / flip table ─────────────────────────────────────

describe("graph / cycles / flip-table", () => {
  it("rejects a local transition to an unknown step", () => {
    const def = flow();
    step(def, "password").transitions.submit = { target: "nowhere" };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "password": transition "submit" targets unknown step "nowhere"',
    );
  });

  it("rejects a cross-flow transition with an invalid action", () => {
    const def = flow();
    step(def, "password").transitions.submit = { target: "other-flow", action: "jump" };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "password": transition "submit" has invalid action "jump"',
    );
  });

  it("accepts the default flow's purpose-switch navigations", () => {
    // The default flow ships them (identifier → register, register →
    // identifier); the blanket valid-flow test covers this, but pin the
    // shape here so the graph rules keep accepting it explicitly.
    const def = flow();
    expect(step(def, "identifier").transitions.register).toEqual({
      target: "register",
      purpose: "register",
    });
    expect(errors(validateFlowDefinition(def, schema))).toEqual([]);
  });

  it("rejects a transition that declares both purpose and action", () => {
    const def = flow();
    step(def, "identifier").transitions.register = {
      target: "register",
      purpose: "register",
      action: "switch",
    };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": transition "register" declares both purpose and action; a transition either re-purposes locally or targets another flow',
    );
  });

  it("rejects a purposed transition to a purpose the flow does not serve", () => {
    const def = flow();
    step(def, "identifier").transitions.register = {
      target: "register",
      purpose: "recovery",
    };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": transition "register" re-purposes to "recovery", which this definition does not serve',
    );
  });

  it("rejects a purposed transition that misses the purpose's entry step", () => {
    const def = flow();
    step(def, "identifier").transitions.register = {
      target: "password",
      purpose: "register",
    };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": transition "register" re-purposes to "register" but targets "password"; it must target that purpose\'s entry step "register"',
    );
  });

  it("rejects an unknown purpose value on a transition", () => {
    const def = flow();
    step(def, "identifier").transitions.register = {
      target: "register",
      purpose: "shopping",
    };
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "identifier": transition "register" has invalid purpose',
    );
  });

  it("rejects an unreachable step", () => {
    const def = flow();
    def.steps.push({
      name: "island",
      fields: ["email"],
      actions: [{ name: "submit", kind: "submit" }],
      transitions: { submit: { target: "done" } },
    });
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "island" is unreachable from any entry point',
    );
  });

  it("rejects a trapped cycle with no path out", () => {
    const def = flow();
    def.steps.push(
      {
        name: "loop-a",
        actions: [{ name: "next", kind: "navigate" }],
        transitions: { next: { target: "loop-b" } },
      },
      {
        name: "loop-b",
        actions: [{ name: "next", kind: "navigate" }],
        transitions: { next: { target: "loop-a" } },
      },
    );
    step(def, "identifier").transitions.detour = { target: "loop-a" };
    step(def, "identifier").actions.push({ name: "detour", kind: "navigate" });
    const msgs = messages(validateFlowDefinition(def));
    expect(msgs).toContain('step "loop-a" is trapped: no path to a terminal step or another flow');
    expect(msgs).toContain('step "loop-b" is trapped: no path to a terminal step or another flow');
  });

  it("rejects a login entry without user_not_found when register is wired (codex regression)", () => {
    const def = flow();
    delete step(def, "identifier").transitions.user_not_found;
    const issues = validateFlowDefinition(def, schema);
    expect(messages(issues)).toContain(
      'step "identifier": entry step for purpose "login" must wire "user_not_found" transition because "register" is also a purpose: without it, someone without an account gets stuck at sign-in instead of being routed to registration',
    );
    expect(issues.find((i) => i.rule === "flip-table")).toBeDefined();
  });

  it("rejects a register entry without user_already_exists when login is wired", () => {
    const def = flow();
    delete step(def, "register").transitions.user_already_exists;
    expect(messages(validateFlowDefinition(def))).toContain(
      'step "register": entry step for purpose "register" must wire "user_already_exists" transition because "login" is also a purpose: without it, someone who already has an account gets stuck at registration instead of being routed to sign-in',
    );
  });
});

// ── phase 5: schema-dependent rules ──────────────────────────────────────────

describe("schema-dependent rules", () => {
  it("rejects a schema with no properties", () => {
    const def = flow();
    expect(messages(validateFlowDefinition(def, { title: "empty" }))).toContain(
      "user schema has no properties",
    );
  });

  it("rejects when required schema fields are collected nowhere (sorted list)", () => {
    const def = flow();
    const withRequired = structuredClone(schema);
    withRequired.required = ["givenName", "email", "familyName"];
    step(def, "identifier").fields = ["email"];
    step(def, "register").fields = ["email"];
    expect(messages(validateFlowDefinition(def, withRequired))).toContain(
      "required fields [familyName givenName] in user schema are missing in the flow definition steps",
    );
  });

  it("rejects a field that is not a schema property", () => {
    const def = flow();
    step(def, "register").fields.push("company");
    expect(messages(validateFlowDefinition(def, schema))).toContain(
      'step "register": flow field: not a property in the user schema: "company"',
    );
  });

  // A nested property is addressed by the same dotted path the attribute
  // store keys it under (walkUserProperty in the Go resolver).
  describe("nested properties", () => {
    const nested = () => {
      const withNested = structuredClone(schema);
      (withNested.properties as Record<string, unknown>).address = {
        type: "object",
        required: ["street"],
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
      };
      return withNested;
    };

    it("accepts a nested leaf addressed by its dotted path", () => {
      const def = flow();
      step(def, "register").fields.push("address.street");
      expect(messages(validateFlowDefinition(def, nested()))).not.toContain(
        'step "register": flow field: not a property in the user schema: "address.street"',
      );
    });

    it("rejects an unknown nested leaf", () => {
      const def = flow();
      step(def, "register").fields.push("address.country");
      expect(messages(validateFlowDefinition(def, nested()))).toContain(
        'step "register": flow field: not a property in the user schema: "address.country"',
      );
    });

    it("rejects a path through a scalar intermediate", () => {
      const def = flow();
      step(def, "register").fields.push("email.domain");
      expect(messages(validateFlowDefinition(def, nested()))).toContain(
        'step "register": flow field: not a property in the user schema: "email.domain"',
      );
    });

    it("rejects naming the object itself", () => {
      const def = flow();
      step(def, "register").fields.push("address");
      expect(messages(validateFlowDefinition(def, nested()))).toContain(
        'step "register": flow field: not a scalar property, name a nested leaf instead: "address"',
      );
    });

    it("demands a required object's required leaf by its path", () => {
      const withRequired = nested();
      withRequired.required = ["address"];
      const def = flow();
      step(def, "identifier").fields = ["email"];
      step(def, "register").fields = ["email"];
      expect(messages(validateFlowDefinition(def, withRequired))).toContain(
        "required fields [address.street] in user schema are missing in the flow definition steps",
      );
    });

    it("covers a required object without its own required by any leaf beneath it", () => {
      const withRequired = structuredClone(schema);
      (withRequired.properties as Record<string, unknown>).address = {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
      };
      withRequired.required = ["address"];
      const def = flow();
      step(def, "register").fields.push("address.city");
      expect(messages(validateFlowDefinition(def, withRequired))).not.toContain(
        "required fields [address] in user schema are missing in the flow definition steps",
      );
    });

    // An optional object exists in the collected document only because a
    // step collected something beneath it, and from that point the
    // document validator enforces its `required` list.
    it("demands an optional object's required leaf once a step collects into it", () => {
      const def = flow();
      step(def, "register").fields.push("address.city");
      expect(messages(validateFlowDefinition(def, nested()))).toContain(
        "required fields [address.street] in user schema are missing in the flow definition steps",
      );
    });

    it("accepts an optional object whose required leaf is collected too", () => {
      const def = flow();
      step(def, "register").fields.push("address.city", "address.street");
      expect(messages(validateFlowDefinition(def, nested()))).not.toContain(
        "required fields [address.street] in user schema are missing in the flow definition steps",
      );
    });

    it("demands nothing from an optional object no step collects into", () => {
      const def = flow();
      expect(messages(validateFlowDefinition(def, nested()))).not.toContain(
        "required fields [address.street] in user schema are missing in the flow definition steps",
      );
    });

    // The same rule one level down: `geo` is optional inside `address`,
    // which is itself required, so the descent has to keep alternating
    // between required names and materialized ones.
    it("demands the leaf of an optional object nested in a required one", () => {
      const withGeo = structuredClone(schema);
      withGeo.required = ["address"];
      (withGeo.properties as Record<string, unknown>).address = {
        type: "object",
        required: ["street"],
        properties: {
          street: { type: "string" },
          city: { type: "string" },
          geo: {
            type: "object",
            required: ["lat"],
            properties: { lat: { type: "string" }, lng: { type: "string" } },
          },
        },
      };
      const def = flow();
      step(def, "register").fields.push("address.street", "address.geo.lng");
      expect(messages(validateFlowDefinition(def, withGeo))).toContain(
        "required fields [address.geo.lat] in user schema are missing in the flow definition steps",
      );
    });

    it("rejects a property carrying items but no type", () => {
      const withItems = structuredClone(schema);
      (withItems.properties as Record<string, unknown>).tags = { items: { type: "string" } };
      const def = flow();
      step(def, "register").fields.push("tags");
      expect(messages(validateFlowDefinition(def, withItems))).toContain(
        'step "register": flow field: not a scalar property, name a nested leaf instead: "tags"',
      );
    });
  });

  it("rejects an ambiguous JSON type union but accepts the nullable idiom", () => {
    const withUnions = structuredClone(schema);
    (withUnions.properties as Record<string, unknown>).mixed = { type: ["string", "number"] };
    (withUnions.properties as Record<string, unknown>).nullable = { type: ["null", "string"] };
    const def = flow();
    step(def, "register").fields.push("mixed", "nullable");
    const msgs = messages(validateFlowDefinition(def, withUnions));
    expect(msgs).toContain(
      'step "register": flow field: unsupported JSON type: [string number]',
    );
    expect(msgs).not.toContain(
      'step "register": flow field: unsupported JSON type: [null string]',
    );
  });

  it("rejects a non-password auth-method field", () => {
    const def = flow();
    step(def, "password").fields.push("x-auth-methods#sms");
    expect(messages(validateFlowDefinition(def, schema))).toContain(
      'step "password": unknown field type for "x-auth-methods#sms"',
    );
  });

  it("rejects x-auth-methods#password when the method is disabled", () => {
    const disabled = structuredClone(schema);
    (disabled["x-auth-methods"] as Record<string, { enabled: boolean }>).password!.enabled = false;
    expect(messages(validateFlowDefinition(flow(), disabled))).toContain(
      'step "password": "password" is not an enabled authentication method',
    );
  });

  it("rejects every step offering a passkey action when the schema disables passkey", () => {
    const disabled = structuredClone(schema);
    (disabled["x-auth-methods"] as Record<string, { enabled: boolean }>).passkey!.enabled = false;
    const issues = validateFlowDefinition(flow(), disabled);
    const msgs = messages(issues);
    expect(msgs).toContain(
      'step "identifier": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
    );
    expect(msgs).toContain(
      'step "password": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
    );
    expect(msgs).toContain(
      'step "register": action "passkey_register" offers passkey but "passkey" is not an enabled authentication method',
    );
    expect(issues.every((i) => i.rule === "schema/passkey-actions")).toBe(true);
  });

  it("rejects passkey actions when the schema has no passkey entry", () => {
    const absent = structuredClone(schema);
    delete (absent["x-auth-methods"] as Record<string, unknown>).passkey;
    expect(messages(validateFlowDefinition(flow(), absent))).toContain(
      'step "identifier": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
    );
  });

  it("accepts passkey and passkey_register actions when passkey is enabled", () => {
    // The default schema enables passkey; the default flow offers passkey
    // on identifier/password and passkey_register on register.
    expect(validateFlowDefinition(flow(), schema)).toEqual([]);
  });

  it("rejects on_success create_user without an upstream identifier", () => {
    // Minimal register-only flow: the create_user step collects a password
    // but no step on its path collects an identifier-challenge field.
    const def = {
      name: "register-only",
      status: "active",
      user_schema: "sch_x",
      purposes: { register: "register-password" },
      steps: [
        {
          name: "register-password",
          fields: ["x-auth-methods#password"],
          actions: [{ name: "submit", kind: "submit", primary: true }],
          on_success: "create_user",
          transitions: { submit: { target: "done" } },
        },
        { name: "done", complete: "show" },
      ],
    };
    const relaxed = structuredClone(schema);
    delete relaxed.required;
    expect(messages(validateFlowDefinition(def, relaxed))).toContain(
      'step "register-password": on_success create_user requires "identifier" to be collected upstream',
    );
  });

  it("skips schema-dependent rules when no schema is provided", () => {
    const def = flow();
    step(def, "register").fields.push("company");
    expect(validateFlowDefinition(def)).toEqual([]);
  });

  it("skips schema-dependent rules while flow-local errors exist", () => {
    const def = flow();
    step(def, "register").fields.push("company");
    step(def, "identifier").transitions.jump = { target: "done" };
    const issues = validateFlowDefinition(def, schema);
    expect(issues.every((i) => i.rule === "steps")).toBe(true);
  });
});

// ── warning: password without identifier ─────────────────────────────────────

describe("warn/password-without-identifier", () => {
  it("warns when the login path collects a password with no identifier upstream", () => {
    const def = flow();
    // Login entry collects the password directly; no email field anywhere
    // on the login path upstream of it.
    def.purposes = { login: "password" };
    def.steps = def.steps.filter((s) => ["password", "done"].includes(s.name));
    const relaxed = structuredClone(schema);
    delete relaxed.required;
    const issues = validateFlowDefinition(def, relaxed);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toHaveLength(1);
    expect(warnings(issues)[0]?.message).toBe(
      'step "password" collects x-auth-methods#password on the login path but no upstream step collects an identifier field — the engine cannot resolve which user to challenge',
    );
  });

  it("does not warn when an identifier is collected upstream (default flow)", () => {
    expect(warnings(validateFlowDefinition(flow(), schema))).toEqual([]);
  });

  it("warns when only a non-login route into a shared step collects the identifier", () => {
    // The login entry reaches `password` directly (no identifier); only the
    // register chain collects email. An ancestor-set check would see the
    // register-side identifier and stay silent — but the direct login route
    // still cannot resolve which user to challenge.
    const def = {
      name: "login",
      status: "active",
      user_schema: "sch_x",
      purposes: { login: "quick", register: "register" },
      steps: [
        {
          name: "quick",
          fields: [],
          actions: [{ name: "go", kind: "navigate", primary: true }],
          transitions: { go: { target: "password" }, user_not_found: { target: "register" } },
        },
        {
          name: "register",
          fields: ["email"],
          actions: [{ name: "submit", kind: "submit", primary: true }],
          transitions: {
            submit: { target: "password" },
            user_already_exists: { target: "password" },
          },
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
    const relaxed = structuredClone(schema);
    delete relaxed.required;
    const issues = validateFlowDefinition(def, relaxed);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.step)).toEqual(["password"]);
  });
});

// ── drift audit against the Go source ────────────────────────────────────────

describe("drift audit (Go validator)", () => {
  const goSource = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "internal/domain/flow_definition_validator.go",
  );

  const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

  it.skipIf(!existsSync(goSource))("every goRef function still exists in the Go source", () => {
    const source = readFileSync(goSource, "utf8");
    for (const [rule, { goRef }] of Object.entries(FLOW_VALIDATION_RULES)) {
      if (goRef === null) continue;
      expect(source, `rule ${rule} → Go func ${goRef}`).toMatch(
        new RegExp(`func ${goRef}\\(`),
      );
    }
  });

  it.skipIf(!existsSync(goSource))("the Go validator gained no unported functions", () => {
    const source = readFileSync(goSource, "utf8");
    const goFuncs = [...source.matchAll(/^func (\w+)\(/gm)].map((m) => m[1]).sort();
    const ported = Object.values(FLOW_VALIDATION_RULES)
      .map((rule) => rule.goRef)
      .filter((ref) => ref !== null);
    // Traversal/aggregation helpers of already-ported rules, plus the
    // orchestrator itself. NOT a place to park an unported rule: the
    // "still exists" check above is one-directional and can never
    // notice an addition — a new Go rule that stays unported silently
    // reopens the plan-passes/apply-fails gap this port closes. When
    // this test fails on a new function, port the rule (or record a
    // scope cut in validate.ts) before extending the list.
    const helpers = [
      "ValidateFlowDefinition",
      "uniqueNonEmptyFields",
      "bfsReachable",
      "isEscapeNode",
      "reachableSteps",
      "someStepEstablishesKind",
    ];
    expect(goFuncs).toEqual([...ported, ...helpers].sort());
  });

  it.skipIf(!existsSync(goSource))("shared literals still match the Go source", () => {
    const source = readFileSync(goSource, "utf8");
    for (const outcome of RESERVED_OUTCOMES) {
      expect(source).toContain(`"${outcome}"`);
    }
    // The passkey-action rule's message must stay verbatim-identical.
    expect(source).toContain(
      'offers passkey but "passkey" is not an enabled authentication method',
    );
    // The flip-table impact suffixes must stay verbatim-identical.
    expect(source).toContain(
      "someone without an account gets stuck at sign-in instead of being routed to registration",
    );
    expect(source).toContain(
      "someone who already has an account gets stuck at registration instead of being routed to sign-in",
    );
    // purposeFlipTargets: login→user_not_found→register, register→user_already_exists→login.
    expect(source).toContain("FlowDefinitionPurposeLogin: {");
    expect(source).toContain("FlowImplicitOutcomeUserNotFound: FlowDefinitionPurposeRegister");
    expect(source).toContain("FlowImplicitOutcomeUserAlreadyExists: FlowDefinitionPurposeLogin");
    expect(Object.keys(PURPOSE_FLIP_TARGETS)).toEqual(["login", "register"]);
  });

  const purposesSource = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "internal/domain/flow_definition.go",
  );

  it.skipIf(!existsSync(purposesSource))("purpose enum matches the Go source exactly", () => {
    const source = readFileSync(purposesSource, "utf8");
    const block =
      source.match(/FlowDefinitionPurposeLogin FlowDefinitionPurpose = iota[\s\S]*?\n\)/)?.[0] ?? "";
    const goPurposes = [...block.matchAll(/FlowDefinitionPurpose(\w+)/g)].map(([, name]) =>
      snake(name ?? ""),
    );
    // Exact, not subset: a purpose added in Go but missing here makes
    // the port reject a valid flow at plan time.
    expect(goPurposes).toEqual([...FLOW_PURPOSES]);
  });

  it.skipIf(!existsSync(purposesSource))("action kinds match the Go enum exactly", () => {
    const source = readFileSync(purposesSource, "utf8");
    const block =
      source.match(/FlowActionKindUnset FlowActionKind = iota[\s\S]*?\n\)/)?.[0] ?? "";
    const goKinds = [
      ...block.matchAll(/^\s*FlowActionKind(\w+)(?: FlowActionKind = iota)?$/gm),
    ].map(([, name]) => snake(name ?? ""));
    // unset and back are rejected by the steps rule; the rest is
    // DECLARABLE_ACTION_KINDS in validate.ts — keep the two in sync.
    expect(goKinds).toEqual(["unset", "submit", "passkey", "passkey_register", "navigate", "back"]);
  });

  const onSuccessSource = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "internal/domain/flow_on_success.go",
  );

  it.skipIf(!existsSync(onSuccessSource))("on_success manifests match the Go source exactly", () => {
    const source = readFileSync(onSuccessSource, "utf8");
    const body = source.match(/func ManifestForOnSuccess[\s\S]*?\n}/)?.[0] ?? "";
    const cases = [...body.matchAll(/case FlowOnSuccess(\w+):/g)].map(([, name]) =>
      snake(name ?? ""),
    );
    // Mirrors ON_SUCCESS_MANIFESTS in validate.ts (keys and kinds): an
    // on_success gaining a manifest in Go without a port here skips its
    // collected-upstream check at plan time.
    expect(cases).toEqual(["create_user"]);
    expect(body).toContain("FlowFieldChallengeIdentifier, FlowFieldChallengePassword");
  });
});
