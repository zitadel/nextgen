import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema, getDefaultLoginFlow } from "@zitadel/config/defaults";
import { ZitadelError } from "../../../../src/lib/errors";
import { applySsoToFlow, applySsoToSchema, ssoEditRefusal } from "../../../../src/lib/idp";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");

/** The design's worked example: the shipped flow with Google added. */
const reference = JSON.parse(
  readFileSync(join(repoRoot, "docs/design/idp/schemas/default-login.scaffold.json"), "utf8"),
) as Record<string, unknown>;

const bothMethods = { password: true, passkey: true };

/** A step's transitions as plain `outcome -> target step` pairs. */
function targetsOf(flow: object, step: string): Record<string, string> {
  const transitions = stepNamed(flow, step).transitions as
    | Record<string, { target?: string }>
    | undefined;
  return Object.fromEntries(
    Object.entries(transitions ?? {}).map(([outcome, transition]) => [
      outcome,
      transition.target ?? "",
    ]),
  );
}

/** The named step, asserted to exist so the assertions below can index it. */
function stepNamed(flow: object, name: string): Record<string, unknown> {
  const steps = (flow as { steps?: Array<Record<string, unknown>> }).steps ?? [];
  const step = steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`the flow has no ${name} step`);
  }
  return step;
}

function shippedFlow(): Record<string, unknown> {
  return getDefaultLoginFlow({ useCase: "minimal" }) as unknown as Record<string, unknown>;
}

describe("applySsoToSchema", () => {
  it("enables the provider without touching password or passkey", () => {
    const schema = getDefaultHumanUserSchema({ useCase: "minimal" }) as unknown as Record<
      string,
      unknown
    >;
    const before = structuredClone(schema["x-auth-methods"]) as Record<string, unknown>;

    const { document, changed } = applySsoToSchema(schema, "google");

    const methods = (document as Record<string, unknown>)["x-auth-methods"] as Record<
      string,
      unknown
    >;
    expect(changed).toBe(true);
    expect(methods.sso).toEqual({ enabled: true, providers: ["google"] });
    expect(methods.password).toEqual(before.password);
    expect(methods.passkey).toEqual(before.passkey);
  });

  it("is a no-op the second time", () => {
    const first = applySsoToSchema(getDefaultHumanUserSchema({ useCase: "minimal" }), "google");
    const second = applySsoToSchema(first.document, "google");

    expect(second.changed).toBe(false);
    expect(second.document).toEqual(first.document);
  });

  it("keeps a provider that is already enabled when adding another", () => {
    const first = applySsoToSchema(getDefaultHumanUserSchema({ useCase: "minimal" }), "google");
    const second = applySsoToSchema(first.document, "github");

    const methods = (second.document as Record<string, unknown>)["x-auth-methods"] as Record<
      string,
      unknown
    >;
    expect((methods.sso as { providers: string[] }).providers).toEqual(["google", "github"]);
  });
});

describe("applySsoToFlow", () => {
  it("produces the flow the design documents", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);

    // Two differences that are not this generator's doing: the reference
    // carries a $schema pointer the shipped flow does not, and it leaves
    // user_schema as the `${USER_SCHEMA_URL}` placeholder the templates
    // render at scaffold time.
    const expected = { ...reference };
    const actual = { ...(document as Record<string, unknown>) };
    for (const key of ["$schema", "user_schema"]) {
      delete expected[key];
      delete actual[key];
    }
    expect(actual).toEqual(expected);
  });

  it("offers the provider on the steps that can start a sign-in", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const byName = new Map(
      ((document as { steps: Array<Record<string, unknown>> }).steps ?? []).map((s) => [s.name, s]),
    );

    expect(byName.get("identifier")?.sso_providers).toEqual(["google"]);
    expect(byName.get("register")?.sso_providers).toEqual(["google"]);
    // The password step is reached only after an identifier, so it shows none.
    expect(byName.get("password")?.sso_providers).toBeUndefined();
  });

  it("routes the three outcomes a provider return can produce", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const targets = targetsOf(document, "identifier");

    expect(targets.sso_authenticated).toBe("done");
    expect(targets.sso_user_not_found).toBe("register-sso");
    expect(targets.user_already_exists).toBe("sso-conflict");
    expect(targets.sso_user_already_exists).toBeUndefined();
    // Typing an unknown email still goes to registration, as before.
    expect(targets.user_not_found).toBe("register");
  });

  it("retargets the shared outcome on both registration steps", () => {
    // The colliding account may be SSO-only, so the password step would
    // dead-end it; the conflict step offers every way back in.
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    for (const name of ["register", "register-password"]) {
      expect(targetsOf(document, name).user_already_exists).toBe("sso-conflict");
    }
    expect(targetsOf(document, "sso-conflict").user_already_exists).toBe("sso-conflict");
    expect(targetsOf(document, "sso-conflict").sso_user_already_exists).toBeUndefined();
  });

  it("offers only the methods the schema enables on the conflict step", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", {
      password: false,
      passkey: true,
    });
    const step = stepNamed(document, "sso-conflict");

    expect(step.fields).toEqual([]);
    expect((step.actions as Array<{ name: string }>).map((a) => a.name)).toEqual([
      "passkey",
      "sign_in",
    ]);
    expect(step.transitions).not.toHaveProperty("submit");
  });

  it("sends the conflict step's sign-in back to the flow's own login entry", () => {
    // The engine rejects a transition that re-purposes to `login` while
    // targeting anything but that purpose's entry step, and a passkey-first
    // flow does not start at `identifier`.
    const passkeyFirst = getDefaultLoginFlow({ useCase: "minimal", preset: "passkey-first" });
    const entry = (passkeyFirst as unknown as { purposes: { login: string } }).purposes.login;

    const { document } = applySsoToFlow(passkeyFirst, "google", bothMethods);

    expect(entry).not.toBe("identifier");
    expect(targetsOf(document, "sso-conflict").sign_in).toBe(entry);
  });

  it("offers a second provider on every step that already had the first", () => {
    const first = applySsoToFlow(shippedFlow(), "google", bothMethods);

    const second = applySsoToFlow(first.document, "github", bothMethods);

    expect(second.changed).toBe(true);
    // Nothing was hand-edited — the generator wrote every one of these.
    expect(second.skipped).toEqual([]);
    for (const step of ["identifier", "register", "sso-conflict"]) {
      expect(stepNamed(second.document, step).sso_providers, step).toEqual(["google", "github"]);
    }
  });

  it("does not offer providers on the step that collects what the provider missed", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);

    expect(stepNamed(document, "register-sso").sso_providers).toBeUndefined();
  });

  it("reports a step the generator did not write as hand-edited, key order aside", () => {
    const first = applySsoToFlow(shippedFlow(), "google", bothMethods);
    // Managed files are written key-sorted, so a flow that has been through
    // `apply` comes back with its keys in a different order. That is not an
    // edit, and reporting it as one would tell the developer to fix nothing.
    const sortDeep = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sortDeep)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
            )
          : value;
    const reserialised = sortDeep(first.document) as object;

    expect(applySsoToFlow(reserialised, "google", bothMethods).skipped).toEqual([]);
  });

  it("leaves out the sign-in escape on a flow that does not serve login", () => {
    // `sso enable` edits every flow bound to the schema, and a register-only
    // flow has nowhere to send someone who wants to sign in — the validator
    // rejects a transition that re-purposes to a purpose the flow lacks.
    const registerOnly = {
      name: "register-only",
      purposes: { register: "register" },
      steps: [
        { name: "register", fields: ["email"], actions: [], transitions: {} },
        { name: "done", complete: "show" },
      ],
    };

    const { document } = applySsoToFlow(registerOnly, "google", bothMethods);
    const conflict = stepNamed(document, "sso-conflict");

    expect(conflict.transitions).not.toHaveProperty("sign_in");
    expect((conflict.actions as Array<{ name: string }>).map((a) => a.name)).not.toContain(
      "sign_in",
    );
  });

  it("is a no-op the second time", () => {
    const first = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const second = applySsoToFlow(first.document, "google", bothMethods);

    expect(second.changed).toBe(false);
    expect(second.skipped).toEqual([]);
    expect(second.document).toEqual(first.document);
  });

  it("leaves a hand-edited step alone and reports it", () => {
    const first = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const edited = structuredClone(first.document) as { steps: Array<Record<string, unknown>> };
    const conflict = edited.steps.find((s) => s.name === "sso-conflict");
    (conflict as Record<string, unknown>).fields = ["email"];

    const second = applySsoToFlow(edited, "google", bothMethods);

    expect(second.skipped).toEqual([{ region: "steps.sso-conflict", reason: "hand-edited" }]);
    const after = (second.document as { steps: Array<Record<string, unknown>> }).steps.find(
      (s) => s.name === "sso-conflict",
    );
    expect(after?.fields).toEqual(["email"]);
  });

  /** The flow the previous CLI wrote: today's output under the old outcome keys. */
  function previousCliFlow(): { steps: Array<Record<string, unknown>> } {
    const current = applySsoToFlow(shippedFlow(), "google", bothMethods).document;
    const legacy = structuredClone(current) as { steps: Array<Record<string, unknown>> };
    for (const step of legacy.steps) {
      const transitions = step.transitions as Record<string, unknown> | undefined;
      if (transitions === undefined) continue;
      for (const [next, old] of [
        ["sso_authenticated", "callback"],
        ["sso_user_not_found", "identity_unknown"],
      ] as const) {
        if (next in transitions) {
          transitions[old] = transitions[next];
          delete transitions[next];
        }
      }
    }
    return legacy;
  }

  function oldKeysIn(flow: object): string[] {
    const found: string[] = [];
    for (const step of (flow as { steps: Array<Record<string, unknown>> }).steps) {
      for (const key of Object.keys((step.transitions as object | undefined) ?? {})) {
        if (key === "callback" || key === "identity_unknown")
          found.push(`${String(step.name)}.${key}`);
      }
    }
    return found;
  }

  it("migrates the transition keys of a flow written by the previous CLI", () => {
    const legacy = previousCliFlow();
    expect(oldKeysIn(legacy)).not.toEqual([]);

    const second = applySsoToFlow(legacy, "github", bothMethods);

    expect(oldKeysIn(second.document)).toEqual([]);
    // After the rename the generated steps match the template again.
    expect(second.skipped).toEqual([]);
    for (const step of ["identifier", "register", "sso-conflict"]) {
      expect(stepNamed(second.document, step).sso_providers, step).toEqual(["google", "github"]);
      expect(targetsOf(second.document, step).sso_authenticated, step).toBe("done");
      expect(targetsOf(second.document, step).sso_user_not_found, step).toBe("register-sso");
    }
  });

  it("renames the keys of a hand-edited step and keeps its other edits", () => {
    const legacy = previousCliFlow();
    const conflict = legacy.steps.find((s) => s.name === "sso-conflict")!;
    conflict.fields = ["email"];

    const second = applySsoToFlow(legacy, "google", bothMethods);

    expect(second.skipped).toEqual([{ region: "steps.sso-conflict", reason: "hand-edited" }]);
    expect(stepNamed(second.document, "sso-conflict").fields).toEqual(["email"]);
    expect(oldKeysIn(second.document)).toEqual([]);
    expect(targetsOf(second.document, "sso-conflict").sso_authenticated).toBe("done");
  });

  it("keeps an action transition named like a legacy outcome", () => {
    // `callback` was a valid action name before the rename; its transition is
    // the action's, not the old SSO outcome, and must stay with it.
    const legacy = previousCliFlow();
    const register = legacy.steps.find((s) => s.name === "register")!;
    register.actions = [
      ...((register.actions as unknown[]) ?? []),
      { name: "callback", kind: "submit" },
    ];
    const ownTarget = (register.transitions as Record<string, unknown>).callback;

    const { document } = applySsoToFlow(legacy, "google", bothMethods);

    expect(
      (stepNamed(document, "register").transitions as Record<string, unknown>).callback,
    ).toEqual(ownTarget);
    expect(targetsOf(document, "identifier").callback).toBeUndefined();
    expect(targetsOf(document, "identifier").sso_authenticated).toBe("done");
  });

  it("refuses to migrate when an action already uses the new outcome name", () => {
    // `sso_authenticated` was a free action name before this release. Renaming
    // the legacy `callback` onto it would hand the action's route to the
    // generated SSO target without saying so.
    const legacy = previousCliFlow();
    const identifier = legacy.steps.find((s) => s.name === "identifier")!;
    identifier.actions = [
      ...((identifier.actions as unknown[]) ?? []),
      { name: "sso_authenticated", kind: "submit" },
    ];
    const before = structuredClone(legacy);

    let caught: unknown;
    try {
      applySsoToFlow(legacy, "github", bothMethods);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_VALIDATION");
    expect((caught as ZitadelError).message).toContain("identifier");
    expect((caught as ZitadelError).message).toContain("sso_authenticated");
    expect(legacy).toEqual(before);
  });

  it.each([
    ["callback", "sso_authenticated"],
    ["identity_unknown", "sso_user_not_found"],
  ])(
    "refuses to migrate %s onto an action named %s on a step sso enable does not write",
    (old, next) => {
      // The collision check covers only the steps sso enable writes. Elsewhere
      // the rename would drop the legacy key and leave the outcome on the action's route.
      const legacy = previousCliFlow();
      legacy.steps.push({
        name: "custom",
        fields: ["email"],
        actions: [{ name: next, kind: "submit" }],
        transitions: { [old]: { target: "done" }, [next]: { target: "register" } },
      });
      const before = structuredClone(legacy);

      let caught: unknown;
      try {
        applySsoToFlow(legacy, "github", bothMethods);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ZitadelError);
      expect((caught as ZitadelError).code).toBe("E_VALIDATION");
      expect((caught as ZitadelError).message).toContain("custom");
      expect((caught as ZitadelError).message).toContain(next);
      expect(legacy).toEqual(before);
    },
  );

  it.each([
    ["purpose", { purpose: "register" }],
    ["action", { action: "switch" }],
  ])("refuses to migrate a legacy outcome that declares %s", (_, extra) => {
    // Legal on `callback` before the rename; the new key refuses both, and
    // dropping them would change where the author routed it.
    const legacy = previousCliFlow();
    const register = legacy.steps.find((s) => s.name === "register")!;
    const transitions = register.transitions as Record<string, Record<string, unknown>>;
    transitions.callback = { ...transitions.callback, ...extra };
    const before = structuredClone(legacy);

    let caught: unknown;
    try {
      applySsoToFlow(legacy, "github", bothMethods);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_VALIDATION");
    expect((caught as ZitadelError).message).toContain("register");
    expect((caught as ZitadelError).message).toContain("callback");
    expect(legacy).toEqual(before);
  });

  it("refuses when an action collides with a generated outcome, legacy keys or not", () => {
    // A pre-rename flow could name an action `sso_authenticated`; the provider
    // loop would overwrite its route with the generated SSO target.
    const flow = structuredClone(shippedFlow()) as { steps: Array<Record<string, unknown>> };
    const identifier = flow.steps.find((s) => s.name === "identifier")!;
    identifier.actions = [
      ...((identifier.actions as unknown[]) ?? []),
      { name: "sso_authenticated", kind: "submit" },
    ];
    identifier.transitions = {
      ...(identifier.transitions as object),
      sso_authenticated: { target: "register" },
    };
    const before = structuredClone(flow);

    let caught: unknown;
    try {
      applySsoToFlow(flow, "google", bothMethods);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_VALIDATION");
    expect((caught as ZitadelError).message).toContain("identifier");
    expect((caught as ZitadelError).message).toContain("sso_authenticated");
    expect(flow).toEqual(before);
  });

  it("checks every generated outcome on a provider step that also has a fixed name", () => {
    // The login entry here is named `register-password`, so it is both a
    // provider step and the step the shared outcome is retargeted on.
    const flow = {
      name: "custom",
      purposes: { login: "register-password" },
      steps: [
        {
          name: "register-password",
          fields: ["email"],
          actions: [
            { name: "submit", kind: "submit" },
            { name: "sso_authenticated", kind: "submit" },
          ],
          transitions: { submit: { target: "done" }, sso_authenticated: { target: "done" } },
        },
        { name: "done", complete: "show" },
      ],
    };
    const before = structuredClone(flow);

    let caught: unknown;
    try {
      applySsoToFlow(flow, "google", bothMethods);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_VALIDATION");
    expect((caught as ZitadelError).message).toContain("register-password");
    expect(flow).toEqual(before);
  });

  it("keeps the new key when a step carries both the old and the new one", () => {
    const legacy = previousCliFlow();
    const identifier = legacy.steps.find((s) => s.name === "identifier")!;
    (identifier.transitions as Record<string, unknown>).sso_authenticated = { target: "register" };

    const { document } = applySsoToFlow(legacy, "google", bothMethods);

    expect(targetsOf(document, "identifier").callback).toBeUndefined();
  });

  it("adds the new steps before the terminal step", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const names = ((document as { steps: Array<Record<string, unknown>> }).steps ?? []).map(
      (s) => s.name,
    );

    expect(names.indexOf("register-sso")).toBeLessThan(names.indexOf("done"));
    expect(names.indexOf("sso-conflict")).toBeLessThan(names.indexOf("done"));
  });
});

describe("register-sso collects what registration collects", () => {
  /** The SSO step's fields, for a flow scaffolded with `useCase`. */
  function ssoFields(useCase: "minimal" | "consumer" | "business"): unknown {
    const flow = getDefaultLoginFlow({ useCase }) as unknown as Record<string, unknown>;
    const { document } = applySsoToFlow(flow, "google", bothMethods);
    return stepNamed(document, "register-sso").fields;
  }

  it.each([
    ["minimal", ["email"]],
    ["consumer", ["email", "givenName", "familyName"]],
    ["business", ["email", "givenName", "familyName", "companyName"]],
  ] as const)("follows the %s use case", (useCase, expected) => {
    // A provider is not obliged to supply any of these, and the engine shows
    // this step precisely when the claims did not satisfy the schema. A step
    // that can only collect the identifier is a dead end for everything else,
    // so it has to ask for whatever registration asks for.
    expect(ssoFields(useCase)).toEqual(expected);
  });

  it("never asks for a credential", () => {
    // `create_user_with_sso` mints an account whose proof is the provider, so
    // a password box here would collect something the mutation never stores.
    for (const useCase of ["minimal", "consumer", "business"] as const) {
      const fields = ssoFields(useCase) as string[];
      expect(
        fields.some((field) => field.startsWith("x-auth-methods#")),
        useCase,
      ).toBe(false);
    }
  });

  it("follows the register step rather than the schema", () => {
    // The project decides what to ask for. A field removed from registration
    // is not one the provider path should start demanding.
    const flow = getDefaultLoginFlow({ useCase: "business" }) as unknown as Record<string, unknown>;
    const register = stepNamed(flow, "register");
    register.fields = ["email", "givenName"];

    const { document } = applySsoToFlow(flow, "google", bothMethods);

    expect(stepNamed(document, "register-sso").fields).toEqual(["email", "givenName"]);
  });
});

describe("the terminal the generated routes point at", () => {
  /** A flow shaped like the shipped one, but ending somewhere else. */
  const flowEndingAt = (terminal: string) => ({
    name: "custom",
    status: "active",
    user_schema: "https://example.test/u.json",
    purposes: { login: "identifier" },
    steps: [
      { name: "identifier", fields: ["email"], transitions: { submit: { target: terminal } } },
      { name: terminal, complete: "show" },
    ],
  });

  it("routes to the flow's own terminal, not a hard-coded `done`", () => {
    // A flow calling its terminal `complete` was valid before this edit.
    // Writing `done` would point every generated route at a step that does
    // not exist, and `validateFlowDefinition` rejects that on the next plan.
    const { document } = applySsoToFlow(flowEndingAt("complete"), "google", {
      password: true,
      passkey: false,
    });
    const steps = (
      document as { steps: { name: string; transitions?: Record<string, { target: string }> }[] }
    ).steps;
    const targets = steps.flatMap((step) =>
      Object.values(step.transitions ?? {}).map((t) => t.target),
    );

    expect(targets).toContain("complete");
    expect(targets).not.toContain("done");
  });

  it("points every generated transition at a step the flow actually has", () => {
    const { document } = applySsoToFlow(flowEndingAt("finished"), "google", {
      password: false,
      passkey: true,
    });
    const steps = (
      document as { steps: { name: string; transitions?: Record<string, { target: string }> }[] }
    ).steps;
    const names = new Set(steps.map((step) => step.name));

    for (const step of steps) {
      for (const [outcome, transition] of Object.entries(step.transitions ?? {})) {
        expect(names, `${step.name}.${outcome} targets a missing step`).toContain(
          transition.target,
        );
      }
    }
  });

  it("still uses `done` when that is what the flow calls its terminal", () => {
    const { document } = applySsoToFlow(flowEndingAt("done"), "google", {
      password: true,
      passkey: false,
    });
    const steps = (
      document as { steps: { name: string; transitions?: Record<string, { target: string }> }[] }
    ).steps;
    const targets = steps.flatMap((step) =>
      Object.values(step.transitions ?? {}).map((t) => t.target),
    );

    expect(targets).toContain("done");
  });
});

describe("a hand-edited owned step", () => {
  /** The shipped flow, with its conflict step edited by hand. */
  const flowWithEditedConflict = () => ({
    name: "custom",
    status: "active",
    user_schema: "https://example.test/u.json",
    purposes: { login: "identifier" },
    steps: [
      { name: "identifier", fields: ["email"], transitions: { submit: { target: "done" } } },
      {
        name: "sso-conflict",
        // Hand-edited: the passkey action the generator writes is gone.
        fields: ["x-auth-methods#password"],
        actions: [{ name: "submit", kind: "submit", primary: true, text_key: "x" }],
        sso_providers: ["github"],
        transitions: { submit: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
  });

  it("is reported and left exactly as it was, provider list included", () => {
    // Adding the provider and then reporting the step as untouched was the
    // report contradicting itself: it says the step was left alone.
    const { document, skipped } = applySsoToFlow(flowWithEditedConflict(), "google", {
      password: true,
      passkey: true,
    });
    const conflict = (
      document as { steps: { name: string; sso_providers?: unknown[] }[] }
    ).steps.find((step) => step.name === "sso-conflict");

    expect(skipped.map((entry) => entry.region)).toContain("steps.sso-conflict");
    expect(conflict?.sso_providers).toEqual(["github"]);
  });

  it("still gains the provider when the step is the generator's own output", () => {
    // The merge exists for this case: a step holding only an earlier provider
    // must not read as hand-edited.
    const { document, skipped } = applySsoToFlow(
      {
        name: "custom",
        status: "active",
        user_schema: "https://example.test/u.json",
        purposes: { login: "identifier" },
        steps: [
          { name: "identifier", fields: ["email"], transitions: { submit: { target: "done" } } },
          { name: "done", complete: "show" },
        ],
      },
      "google",
      { password: true, passkey: true },
    );
    const conflict = (
      document as { steps: { name: string; sso_providers?: unknown[] }[] }
    ).steps.find((step) => step.name === "sso-conflict");

    expect(skipped).toEqual([]);
    expect(conflict?.sso_providers).toEqual(["google"]);
  });
});

describe("refusing a document the editors would overwrite", () => {
  it("accepts the shipped flow and schema", () => {
    expect(ssoEditRefusal(getDefaultLoginFlow(), "flow")).toBeUndefined();
    expect(ssoEditRefusal(getDefaultHumanUserSchema(), "schema")).toBeUndefined();
  });

  it("accepts a document that has simply not got there yet", () => {
    // An absent region is written, which is the whole point of the editors.
    expect(ssoEditRefusal({}, "schema")).toBeUndefined();
    expect(ssoEditRefusal({ steps: [{ name: "done", complete: "show" }] }, "flow")).toBeUndefined();
  });

  it("refuses a flow with nowhere for a completed sign-in to end", () => {
    // The generated routes need a terminal to point at; inventing `done`
    // would write transitions the validator rejects on the next plan.
    expect(ssoEditRefusal({}, "flow")).toBe("no step marks where a completed sign-in ends");
    expect(ssoEditRefusal({ steps: [] }, "flow")).toBe(
      "no step marks where a completed sign-in ends",
    );
  });

  it("refuses a flow whose steps are not a list", () => {
    // Without this, `steps` reads as empty and is written back as two
    // generated steps, the hand-written value gone and nothing said about it.
    expect(ssoEditRefusal({ steps: "broken" }, "flow")).toBe("steps is not a list");
    expect(ssoEditRefusal({ steps: { identifier: {} } }, "flow")).toBe("steps is not a list");
  });

  it("refuses a flow with an entry that is not a step", () => {
    expect(ssoEditRefusal({ steps: ["identifier"] }, "flow")).toBe("steps[0] is not a step");
  });

  it("refuses a step whose transitions are not an object, naming the step", () => {
    expect(ssoEditRefusal({ steps: [{ name: "identifier", transitions: "x" }] }, "flow")).toBe(
      "steps.identifier.transitions is not an object",
    );
  });

  it("refuses a step whose sso_providers is not a list", () => {
    // addProvider reads a non-list as empty and writes the generated list over
    // it, so `sso_providers: "github"` would silently become ["google"].
    expect(
      ssoEditRefusal(
        {
          steps: [
            { name: "identifier", sso_providers: "github" },
            { name: "done", complete: "show" },
          ],
        },
        "flow",
      ),
    ).toBe("steps.identifier.sso_providers is not a list");
  });

  it("refuses a schema whose auth-method regions are not the shape it edits", () => {
    expect(ssoEditRefusal({ "x-auth-methods": "password" }, "schema")).toBe(
      "x-auth-methods is not an object",
    );
    expect(ssoEditRefusal({ "x-auth-methods": { sso: true } }, "schema")).toBe(
      "x-auth-methods.sso is not an object",
    );
    expect(ssoEditRefusal({ "x-auth-methods": { sso: { providers: "google" } } }, "schema")).toBe(
      "x-auth-methods.sso.providers is not a list",
    );
  });
});
