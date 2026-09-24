import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema, getDefaultLoginFlow } from "./defaults.js";
import { applySsoToFlow, applySsoToSchema } from "./sso.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

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
    Object.entries(transitions ?? {}).map(([outcome, transition]) => [outcome, transition.target ?? ""]),
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
    const schema = getDefaultHumanUserSchema({ useCase: "minimal" }) as unknown as Record<string, unknown>;
    const before = structuredClone(schema["x-auth-methods"]) as Record<string, unknown>;

    const { document, changed } = applySsoToSchema(schema, "google");

    const methods = (document as Record<string, unknown>)["x-auth-methods"] as Record<string, unknown>;
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

    const methods = (second.document as Record<string, unknown>)["x-auth-methods"] as Record<string, unknown>;
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

    expect(targets.callback).toBe("done");
    expect(targets.identity_unknown).toBe("register-sso");
    expect(targets.user_already_exists).toBe("sso-conflict");
    // Typing an unknown email still goes to registration, as before.
    expect(targets.user_not_found).toBe("register");
  });

  it("retargets the shared outcome on the password registration step", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    expect(targetsOf(document, "register-password").user_already_exists).toBe("sso-conflict");
  });

  it("offers only the methods the schema enables on the conflict step", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", { password: false, passkey: true });
    const step = stepNamed(document, "sso-conflict");

    expect(step.fields).toEqual([]);
    expect((step.actions as Array<{ name: string }>).map((a) => a.name)).toEqual(["passkey", "sign_in"]);
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
    expect((conflict.actions as Array<{ name: string }>).map((a) => a.name)).not.toContain("sign_in");
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

  it("adds the new steps before the terminal step", () => {
    const { document } = applySsoToFlow(shippedFlow(), "google", bothMethods);
    const names = ((document as { steps: Array<Record<string, unknown>> }).steps ?? []).map((s) => s.name);

    expect(names.indexOf("register-sso")).toBeLessThan(names.indexOf("done"));
    expect(names.indexOf("sso-conflict")).toBeLessThan(names.indexOf("done"));
  });
});
