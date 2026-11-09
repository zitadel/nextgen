import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getDefaultLoginFlow, type SetupPreset, type SetupUseCase } from "@zitadel/config/defaults";
import { slug } from "@tests/helpers/idp-values";
import { serverCanonicalFlow } from "@zitadel/api-mock";
import { RefusedEditError } from "@/lib/zitadel";
import { SsoGenerator } from "@/lib/zitadel/resources/flows/sso";
import { isObject } from "@/lib/json";
import type { JsonObject } from "@/lib/zitadel/types";
import { toJsonObject } from "@/lib/zitadel/utils/json";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The repository's root, where the design documents live.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../../..");

/**
 * The methods a schema enables when it enables both.
 */
const bothMethods = { password: true, passkey: true };

/**
 * The presets whose password step enabling a provider also edits, in the
 * order the tests run them.
 */
const PRESETS: readonly SetupPreset[] = ["passkey-first", "password-first"];

/**
 * The use cases a flow can be scaffolded for.
 */
const USE_CASES: readonly SetupUseCase[] = ["minimal", "consumer", "business"];

/**
 * The outcome keys the previous CLI wrote, each after the name the engine now
 * raises.
 */
const LEGACY_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["sso_authenticated", "callback"],
  ["sso_user_not_found", "identity_unknown"],
];

/**
 * A flow the tests build, as the generator reads it.
 *
 * @param flow - The flow, as a test built or changed it.
 * @returns The very same object, typed as JSON.
 * @throws {@link ConfigError} When it is not JSON.
 */
function asFlow(flow: unknown): JsonObject {
  return toJsonObject(flow, "the test's flow");
}

/**
 * The list at a key, or an empty one when the key holds anything else.
 *
 * @param body - The object to read.
 * @param key - The key to read.
 * @returns The very list the object holds.
 */
function listIn(body: Record<string, unknown>, key: string): unknown[] {
  const value = body[key];
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/**
 * The object at a key, or an empty one when the key holds anything else.
 *
 * @param body - The object to read.
 * @param key - The key to read.
 * @returns The very object the key holds.
 */
function objectIn(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = body[key];
  if (isObject(value)) {
    return value;
  }
  return {};
}

/**
 * A value asserted to be a JSON object, so a test can read and change it.
 *
 * @param value - Any value, such as a parsed file or an edit's result.
 * @returns The very same object.
 * @throws {@link Error} When the value is not an object.
 */
function objectOf(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error("expected a JSON object");
  }
  return value;
}

/**
 * The steps of a flow that are objects.
 *
 * @param flow - The flow.
 * @returns Its steps, as the very objects the flow holds.
 */
function stepsOf(flow: unknown): Record<string, unknown>[] {
  if (!isObject(flow)) {
    return [];
  }
  return listIn(flow, "steps").filter(isObject);
}

/**
 * The named step, asserted to exist so the assertions below can index it.
 *
 * @param flow - The flow.
 * @param name - The step's name.
 * @returns The step, as the very object the flow holds.
 * @throws {@link Error} When the flow has no such step.
 */
function stepNamed(flow: unknown, name: string): Record<string, unknown> {
  const step = stepsOf(flow).find((candidate) => {
    return candidate.name === name;
  });
  if (step === undefined) {
    throw new Error(`the flow has no ${name} step`);
  }
  return step;
}

/**
 * A step's actions that are objects.
 *
 * @param step - The step.
 * @returns Its actions, as the very objects the step holds.
 */
function actionsOf(step: Record<string, unknown>): Record<string, unknown>[] {
  return listIn(step, "actions").filter(isObject);
}

/**
 * The names of a step's actions, in order.
 *
 * @param step - The step.
 * @returns Each action's name.
 */
function actionNames(step: Record<string, unknown>): unknown[] {
  return actionsOf(step).map((action) => {
    return action.name;
  });
}

/**
 * A step's transitions, asserted to be an object so a test can change them.
 *
 * @param step - The step.
 * @returns The very transitions object the step holds.
 * @throws {@link Error} When the step's transitions are not an object.
 */
function transitionsOf(step: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(step.transitions)) {
    throw new Error(`step ${String(step.name)} has no transitions`);
  }
  return step.transitions;
}

/**
 * A step's transitions as plain `outcome -> target step` pairs.
 *
 * @param step - The step.
 * @returns Each outcome and the step it targets, or an empty string for a
 *   transition that names none.
 */
function routesOf(step: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectIn(step, "transitions")).map(([outcome, transition]) => {
      if (isObject(transition) && typeof transition.target === "string") {
        return [outcome, transition.target];
      }
      return [outcome, ""];
    }),
  );
}

/**
 * The named step's transitions as plain `outcome -> target step` pairs.
 *
 * @param flow - The flow.
 * @param step - The step's name.
 * @returns Each outcome and the step it targets.
 */
function targetsOf(flow: unknown, step: string): Record<string, string> {
  return routesOf(stepNamed(flow, step));
}

/**
 * The message of what an edit threw.
 *
 * @param caught - What was thrown.
 * @returns Its message.
 * @throws {@link Error} When it is not an error.
 */
function messageOf(caught: unknown): string {
  if (!(caught instanceof Error)) {
    throw new Error("the edit threw no error");
  }
  return caught.message;
}

/**
 * The shipped login flow, scaffolded for the minimal use case.
 *
 * @returns A fresh copy, which a test may change.
 */
function shippedFlow(): Record<string, unknown> {
  return objectOf(getDefaultLoginFlow({ useCase: "minimal" }));
}

/**
 * The design's worked example: the shipped flow with Google added.
 */
const reference = objectOf(
  JSON.parse(
    readFileSync(join(repoRoot, "docs/design/idp/schemas/default-login.scaffold.json"), "utf8"),
  ),
);

describe("SsoGenerator.withProvider", () => {
  it("produces the flow the design documents", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);

    // The reference carries a $schema pointer the shipped flow does not,
    // which is not this generator's doing.
    const { $schema: _expectedSchema, ...expected } = reference;
    const { $schema: _actualSchema, ...actual } = document;
    expect(actual).toEqual(expected);
  });

  it("offers the provider on the steps that can start a sign-in", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const byName = new Map(
      stepsOf(document).map((step) => {
        return [step.name, step];
      }),
    );

    expect(byName.get("identifier")?.sso_providers).toEqual(["google"]);
    expect(byName.get("register")?.sso_providers).toEqual(["google"]);
    // Someone who signed up with a provider has no password, and typing their
    // email lands them here: without the button this step is a dead end.
    expect(byName.get("password")?.sso_providers).toEqual(["google"]);
  });

  it("routes the three outcomes a provider return can produce", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
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
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    for (const name of ["register", "register-password"]) {
      expect(targetsOf(document, name).user_already_exists).toBe("sso-conflict");
    }
    expect(targetsOf(document, "sso-conflict").user_already_exists).toBe("sso-conflict");
    expect(targetsOf(document, "sso-conflict").sso_user_already_exists).toBeUndefined();
  });

  it("offers only the methods the schema enables on the conflict step", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), {
      password: false,
      passkey: true,
    });
    const step = stepNamed(document, "sso-conflict");

    expect(step.fields).toEqual([]);
    expect(actionNames(step)).toEqual(["passkey", "sign_in"]);
    expect(step.transitions).not.toHaveProperty("submit");
  });

  it("sends the conflict step's sign-in back to the flow's own login entry", () => {
    // The engine rejects a transition that re-purposes to `login` while
    // targeting anything but that purpose's entry step, and a passkey-first
    // flow does not start at `identifier`.
    const passkeyFirst = getDefaultLoginFlow({ useCase: "minimal", preset: "passkey-first" });
    const entry = objectIn(objectOf(passkeyFirst), "purposes").login;

    const { document } = new SsoGenerator(asFlow(passkeyFirst)).withProvider(slug("google"), bothMethods);

    expect(entry).not.toBe("identifier");
    expect(targetsOf(document, "sso-conflict").sign_in).toBe(entry);
  });

  it("offers a second provider on every step that already had the first", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);

    const second = new SsoGenerator(asFlow(first.document)).withProvider(slug("github"), bothMethods);

    expect(second.changed).toBe(true);
    // Nothing was hand-edited — the generator wrote every one of these.
    expect(second.skipped).toEqual([]);
    for (const step of ["identifier", "register", "sso-conflict"]) {
      expect(stepNamed(second.document, step).sso_providers, step).toEqual(["google", "github"]);
    }
  });

  it("does not offer providers on the step that collects what the provider missed", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);

    expect(stepNamed(document, "register-sso").sso_providers).toBeUndefined();
  });

  it("reports a step the generator did not write as hand-edited, key order aside", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    // Managed files are written key-sorted, so a flow that has been through
    // `apply` comes back with its keys in a different order. That is not an
    // edit, and reporting it as one would tell the developer to fix nothing.
    const sortDeep = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(sortDeep);
      }
      if (!isObject(value)) {
        return value;
      }
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => {
            return [key, sortDeep(value[key])];
          }),
      );
    };
    const reserialised = objectOf(sortDeep(first.document));

    expect(
      new SsoGenerator(asFlow(reserialised)).withProvider(slug("google"), bothMethods).skipped,
    ).toEqual([]);
  });

  it("leaves out the sign-in escape on a flow that does not serve login", () => {
    // `auth-method sso enable` edits every flow bound to the schema, and a register-only
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

    const { document } = new SsoGenerator(asFlow(registerOnly)).withProvider(slug("google"), bothMethods);
    const conflict = stepNamed(document, "sso-conflict");

    expect(conflict.transitions).not.toHaveProperty("sign_in");
    expect(actionNames(conflict)).not.toContain("sign_in");
  });

  it("is a no-op the second time", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const second = new SsoGenerator(asFlow(first.document)).withProvider(slug("google"), bothMethods);

    expect(second.changed).toBe(false);
    expect(second.skipped).toEqual([]);
    expect(second.document).toEqual(first.document);
  });

  it.each([
    { from: { password: true, passkey: false }, to: { password: true, passkey: true } },
    { from: { password: true, passkey: true }, to: { password: false, passkey: true } },
    { from: { password: false, passkey: false }, to: { password: true, passkey: false } },
    { from: { password: false, passkey: true }, to: { password: true, passkey: true } },
  ])(
    "brings a step the generator wrote for other methods up to date ($from -> $to)",
    ({ from, to }) => {
      const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), from);

      const second = new SsoGenerator(asFlow(first.document)).withProvider(slug("google"), to);
      const fresh = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), to);

      expect(second.skipped).toEqual([]);
      expect(second.changed).toBe(true);
      expect(stepNamed(second.document, "sso-conflict")).toEqual(
        stepNamed(fresh.document, "sso-conflict"),
      );
    },
  );

  it("keeps the providers and the position of a step it brings up to date", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), {
      password: true,
      passkey: false,
    });
    const names = (document: unknown): unknown[] => {
      return stepsOf(document).map((step) => {
        return step.name;
      });
    };

    const second = new SsoGenerator(asFlow(first.document)).withProvider(slug("github"), bothMethods);

    expect(names(second.document)).toEqual(names(first.document));
    expect(stepNamed(second.document, "sso-conflict").sso_providers).toEqual(["google", "github"]);
  });

  it("still leaves a step that matches no combination of methods alone", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), {
      password: true,
      passkey: false,
    });
    const edited = objectOf(structuredClone(first.document));
    stepNamed(edited, "sso-conflict").fields = ["email"];

    const second = new SsoGenerator(asFlow(edited)).withProvider(slug("google"), bothMethods);

    expect(second.changed).toBe(false);
    expect(second.skipped).toEqual([
      { step: "sso-conflict", region: "steps.sso-conflict", reason: "hand-edited" },
    ]);
  });

  it("leaves a hand-edited step alone and reports it", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const edited = objectOf(structuredClone(first.document));
    stepNamed(edited, "sso-conflict").fields = ["email"];

    const second = new SsoGenerator(asFlow(edited)).withProvider(slug("google"), bothMethods);

    expect(second.skipped).toEqual([
      { step: "sso-conflict", region: "steps.sso-conflict", reason: "hand-edited" },
    ]);
    expect(stepNamed(second.document, "sso-conflict").fields).toEqual(["email"]);
  });

  /**
   * The flow the previous CLI wrote: today's output under the old outcome keys.
   *
   * @returns The flow, which a test may change.
   */
  function previousCliFlow(): Record<string, unknown> {
    const legacy = objectOf(
      structuredClone(
        new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods).document,
      ),
    );
    for (const step of stepsOf(legacy)) {
      const transitions = step.transitions;
      if (!isObject(transitions)) {
        continue;
      }
      for (const [next, old] of LEGACY_RENAMES) {
        if (next in transitions) {
          transitions[old] = transitions[next];
          delete transitions[next];
        }
      }
    }
    return legacy;
  }

  /**
   * The legacy outcome keys a flow still carries.
   *
   * @param flow - The flow.
   * @returns Each as `step.key`.
   */
  function oldKeysIn(flow: unknown): string[] {
    return stepsOf(flow).flatMap((step) => {
      return Object.keys(objectIn(step, "transitions"))
        .filter((key) => {
          return key === "callback" || key === "identity_unknown";
        })
        .map((key) => {
          return `${String(step.name)}.${key}`;
        });
    });
  }

  it("migrates the transition keys of a flow written by the previous CLI", () => {
    const legacy = previousCliFlow();
    expect(oldKeysIn(legacy)).not.toEqual([]);

    const second = new SsoGenerator(asFlow(legacy)).withProvider(slug("github"), bothMethods);

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
    stepNamed(legacy, "sso-conflict").fields = ["email"];

    const second = new SsoGenerator(asFlow(legacy)).withProvider(slug("google"), bothMethods);

    expect(second.skipped).toEqual([
      { step: "sso-conflict", region: "steps.sso-conflict", reason: "hand-edited" },
    ]);
    expect(stepNamed(second.document, "sso-conflict").fields).toEqual(["email"]);
    expect(oldKeysIn(second.document)).toEqual([]);
    expect(targetsOf(second.document, "sso-conflict").sso_authenticated).toBe("done");
  });

  it("keeps an action transition named like a legacy outcome", () => {
    // `callback` was a valid action name before the rename; its transition is
    // the action's, not the old SSO outcome, and must stay with it.
    const legacy = previousCliFlow();
    const register = stepNamed(legacy, "register");
    register.actions = [...listIn(register, "actions"), { name: "callback", kind: "submit" }];
    const ownTarget = transitionsOf(register).callback;

    const { document } = new SsoGenerator(asFlow(legacy)).withProvider(slug("google"), bothMethods);

    expect(transitionsOf(stepNamed(document, "register")).callback).toEqual(ownTarget);
    expect(targetsOf(document, "identifier").callback).toBeUndefined();
    expect(targetsOf(document, "identifier").sso_authenticated).toBe("done");
  });

  it("refuses to migrate when an action already uses the new outcome name", () => {
    // `sso_authenticated` was a free action name before this release. Renaming
    // the legacy `callback` onto it would hand the action's route to the
    // generated SSO target without saying so.
    const legacy = previousCliFlow();
    const identifier = stepNamed(legacy, "identifier");
    identifier.actions = [
      ...listIn(identifier, "actions"),
      { name: "sso_authenticated", kind: "submit" },
    ];
    const before = structuredClone(legacy);

    const caught = thrownBy(() => {
      return new SsoGenerator(asFlow(legacy)).withProvider(slug("github"), bothMethods);
    });

    expect(caught).toBeInstanceOf(RefusedEditError);
    expect(messageOf(caught)).toContain("identifier");
    expect(messageOf(caught)).toContain("sso_authenticated");
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
      legacy.steps = [
        ...listIn(legacy, "steps"),
        {
          name: "custom",
          fields: ["email"],
          actions: [{ name: next, kind: "submit" }],
          transitions: { [old]: { target: "done" }, [next]: { target: "register" } },
        },
      ];
      const before = structuredClone(legacy);

      const caught = thrownBy(() => {
        return new SsoGenerator(asFlow(legacy)).withProvider(slug("github"), bothMethods);
      });

      expect(caught).toBeInstanceOf(RefusedEditError);
      expect(messageOf(caught)).toContain("custom");
      expect(messageOf(caught)).toContain(next);
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
    const transitions = transitionsOf(stepNamed(legacy, "register"));
    transitions.callback = { ...objectIn(transitions, "callback"), ...extra };
    const before = structuredClone(legacy);

    const caught = thrownBy(() => {
      return new SsoGenerator(asFlow(legacy)).withProvider(slug("github"), bothMethods);
    });

    expect(caught).toBeInstanceOf(RefusedEditError);
    expect(messageOf(caught)).toContain("register");
    expect(messageOf(caught)).toContain("callback");
    expect(legacy).toEqual(before);
  });

  it("refuses when an action collides with a generated outcome, legacy keys or not", () => {
    // A pre-rename flow could name an action `sso_authenticated`; the provider
    // loop would overwrite its route with the generated SSO target.
    const flow = structuredClone(shippedFlow());
    const identifier = stepNamed(flow, "identifier");
    identifier.actions = [
      ...listIn(identifier, "actions"),
      { name: "sso_authenticated", kind: "submit" },
    ];
    identifier.transitions = {
      ...objectIn(identifier, "transitions"),
      sso_authenticated: { target: "register" },
    };
    const before = structuredClone(flow);

    const caught = thrownBy(() => {
      return new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);
    });

    expect(caught).toBeInstanceOf(RefusedEditError);
    expect(messageOf(caught)).toContain("identifier");
    expect(messageOf(caught)).toContain("sso_authenticated");
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

    const caught = thrownBy(() => {
      return new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);
    });

    expect(caught).toBeInstanceOf(RefusedEditError);
    expect(messageOf(caught)).toContain("register-password");
    expect(flow).toEqual(before);
  });

  it("keeps the new key when a step carries both the old and the new one", () => {
    const legacy = previousCliFlow();
    transitionsOf(stepNamed(legacy, "identifier")).sso_authenticated = { target: "register" };

    const { document } = new SsoGenerator(asFlow(legacy)).withProvider(slug("google"), bothMethods);

    expect(targetsOf(document, "identifier").callback).toBeUndefined();
  });

  it("adds the new steps before the terminal step", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const names = stepsOf(document).map((step) => {
      return step.name;
    });

    expect(names.indexOf("register-sso")).toBeLessThan(names.indexOf("done"));
    expect(names.indexOf("sso-conflict")).toBeLessThan(names.indexOf("done"));
  });
});

describe("register-sso collects what registration collects", () => {
  /**
   * The SSO step's fields, for a flow scaffolded with `useCase`.
   *
   * @param useCase - The use case the flow is scaffolded for.
   * @returns The fields the generated `register-sso` step asks for.
   */
  function ssoFields(useCase: SetupUseCase): readonly unknown[] {
    const flow = objectOf(getDefaultLoginFlow({ useCase }));
    const { document } = new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);
    return listIn(stepNamed(document, "register-sso"), "fields");
  }

  /**
   * Each use case, and the fields its `register-sso` step asks for.
   */
  const EXPECTED_FIELDS: ReadonlyArray<readonly [SetupUseCase, readonly string[]]> = [
    ["minimal", ["email"]],
    ["consumer", ["email", "givenName", "familyName"]],
    ["business", ["email", "givenName", "familyName", "companyName"]],
  ];

  it.each(EXPECTED_FIELDS)("follows the %s use case", (useCase, expected) => {
    // A provider is not obliged to supply any of these, and the engine shows
    // this step precisely when the claims did not satisfy the schema. A step
    // that can only collect the identifier is a dead end for everything else,
    // so it has to ask for whatever registration asks for.
    expect(ssoFields(useCase)).toEqual(expected);
  });

  it("never asks for a credential", () => {
    // `create_user_with_sso` mints an account whose proof is the provider, so
    // a password box here would collect something the mutation never stores.
    for (const useCase of USE_CASES) {
      const asksForCredential = ssoFields(useCase).some((field) => {
        return typeof field === "string" && field.startsWith("x-auth-methods#");
      });
      expect(asksForCredential, useCase).toBe(false);
    }
  });

  it("follows the register step rather than the schema", () => {
    // The project decides what to ask for. A field removed from registration
    // is not one the provider path should start demanding.
    const flow = objectOf(getDefaultLoginFlow({ useCase: "business" }));
    const register = stepNamed(flow, "register");
    register.fields = ["email", "givenName"];

    const { document } = new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);

    expect(stepNamed(document, "register-sso").fields).toEqual(["email", "givenName"]);
  });
});

describe("the terminal the generated routes point at", () => {
  /**
   * A flow shaped like the shipped one, but ending somewhere else.
   *
   * @param terminal - The name of the step a completed sign-in ends at.
   * @returns The flow.
   */
  function flowEndingAt(terminal: string): Record<string, unknown> {
    return {
      name: "custom",
      status: "active",
      user_schema: "https://example.test/u.json",
      purposes: { login: "identifier" },
      steps: [
        { name: "identifier", fields: ["email"], transitions: { submit: { target: terminal } } },
        { name: terminal, complete: "show" },
      ],
    };
  }

  /**
   * Every step any transition of a flow targets.
   *
   * @param flow - The flow.
   * @returns The targets, one per transition.
   */
  function allTargets(flow: unknown): string[] {
    return stepsOf(flow).flatMap((step) => {
      return Object.values(routesOf(step));
    });
  }

  it("routes to the flow's own terminal, not a hard-coded `done`", () => {
    // A flow calling its terminal `complete` was valid before this edit.
    // Writing `done` would point every generated route at a step that does
    // not exist, and `validateFlowDefinition` rejects that on the next plan.
    const { document } = new SsoGenerator(asFlow(flowEndingAt("complete"))).withProvider(slug("google"), {
      password: true,
      passkey: false,
    });
    const targets = allTargets(document);

    expect(targets).toContain("complete");
    expect(targets).not.toContain("done");
  });

  it("points every generated transition at a step the flow actually has", () => {
    const { document } = new SsoGenerator(asFlow(flowEndingAt("finished"))).withProvider(slug("google"), {
      password: false,
      passkey: true,
    });
    const steps = stepsOf(document);
    const names = new Set(
      steps.map((step) => {
        return step.name;
      }),
    );

    for (const step of steps) {
      for (const [outcome, target] of Object.entries(routesOf(step))) {
        expect(names, `${String(step.name)}.${outcome} targets a missing step`).toContain(target);
      }
    }
  });

  it("still uses `done` when that is what the flow calls its terminal", () => {
    const { document } = new SsoGenerator(asFlow(flowEndingAt("done"))).withProvider(slug("google"), {
      password: true,
      passkey: false,
    });

    expect(allTargets(document)).toContain("done");
  });
});

describe("a hand-edited owned step", () => {
  /**
   * The shipped flow, with its conflict step edited by hand.
   *
   * @returns The flow.
   */
  function flowWithEditedConflict(): Record<string, unknown> {
    return {
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
    };
  }

  it("is reported and left exactly as it was, provider list included", () => {
    // Adding the provider and then reporting the step as untouched was the
    // report contradicting itself: it says the step was left alone.
    const { document, skipped } = new SsoGenerator(asFlow(flowWithEditedConflict())).withProvider(
      slug("google"),
      {
        password: true,
        passkey: true,
      },
    );
    const regions = skipped.map((entry) => {
      return entry.region;
    });

    expect(regions).toContain("steps.sso-conflict");
    expect(stepNamed(document, "sso-conflict").sso_providers).toEqual(["github"]);
  });

  it("still gains the provider when the step is the generator's own output", () => {
    // The merge exists for this case: a step holding only an earlier provider
    // must not read as hand-edited.
    const { document, skipped } = new SsoGenerator(asFlow({
      name: "custom",
      status: "active",
      user_schema: "https://example.test/u.json",
      purposes: { login: "identifier" },
      steps: [
        { name: "identifier", fields: ["email"], transitions: { submit: { target: "done" } } },
        { name: "done", complete: "show" },
      ],
    })).withProvider(slug("google"), { password: true, passkey: true });

    expect(skipped).toEqual([]);
    expect(stepNamed(document, "sso-conflict").sso_providers).toEqual(["google"]);
  });
});

describe("refusing a document the editors would overwrite", () => {
  it("accepts the shipped flow", () => {
    expect(new SsoGenerator(asFlow(getDefaultLoginFlow())).editRefusal).toBeUndefined();
  });

  it("accepts a document that has simply not got there yet", () => {
    // An absent region is written, which is the whole point of the editors.
    expect(
      new SsoGenerator(asFlow({ steps: [{ name: "done", complete: "show" }] })).editRefusal,
    ).toBeUndefined();
  });

  it("refuses a flow with nowhere for a completed sign-in to end", () => {
    // The generated routes need a terminal to point at; inventing `done`
    // would write transitions the validator rejects on the next plan.
    expect(new SsoGenerator(asFlow({})).editRefusal).toBe("no step marks where a completed sign-in ends");
    expect(new SsoGenerator(asFlow({ steps: [] })).editRefusal).toBe(
      "no step marks where a completed sign-in ends",
    );
  });

  it("refuses a flow whose steps are not a list", () => {
    // Without this, `steps` reads as empty and is written back as two
    // generated steps, the hand-written value gone and nothing said about it.
    expect(new SsoGenerator(asFlow({ steps: "broken" })).editRefusal).toBe("steps is not a list");
    expect(new SsoGenerator(asFlow({ steps: { identifier: {} } })).editRefusal).toBe("steps is not a list");
  });

  it("refuses a flow with an entry that is not a step", () => {
    expect(new SsoGenerator(asFlow({ steps: ["identifier"] })).editRefusal).toBe("steps[0] is not a step");
  });

  it("refuses a step whose transitions are not an object, naming the step", () => {
    expect(
      new SsoGenerator(asFlow({ steps: [{ name: "identifier", transitions: "x" }] })).editRefusal,
    ).toBe("steps.identifier.transitions is not an object");
  });

  it("refuses a step whose sso_providers is not a list", () => {
    // The edit reads a non-list as empty and writes the generated list over
    // it, so `sso_providers: "github"` would silently become ["google"].
    expect(
      new SsoGenerator(asFlow({
        steps: [
          { name: "identifier", sso_providers: "github" },
          { name: "done", complete: "show" },
        ],
      })).editRefusal,
    ).toBe("steps.identifier.sso_providers is not a list");
  });

  it("still gains a second provider after the server dropped its default primary: false", () => {
    // What a real `apply` writes back: the conflict step's non-primary actions
    // no longer say `primary: false`. Without this the step read as hand-edited
    // and a second connection never reached it.
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), {
      password: true,
      passkey: true,
    });
    const written = objectOf(JSON.parse(JSON.stringify(first.document)));
    for (const step of stepsOf(written)) {
      for (const action of actionsOf(step)) {
        if (action.primary === false) {
          delete action.primary;
        }
      }
    }
    const stillDefaulted = actionsOf(stepNamed(written, "sso-conflict")).some((action) => {
      return action.primary === false;
    });
    expect(stillDefaulted).toBe(false);

    const { document, skipped } = new SsoGenerator(asFlow(written)).withProvider(slug("acme-sso"), {
      password: true,
      passkey: true,
    });

    expect(skipped).toEqual([]);
    expect(stepNamed(document, "sso-conflict").sso_providers).toEqual(["google", "acme-sso"]);
  });

  it("still reports a step whose actions really were edited", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), {
      password: true,
      passkey: true,
    });
    const written = objectOf(JSON.parse(JSON.stringify(first.document)));
    // `primary: true` is not the default, so removing the generator's `false`
    // elsewhere must not make this one invisible.
    const passkey = actionsOf(stepNamed(written, "sso-conflict")).find((action) => {
      return action.name === "passkey";
    });
    if (passkey !== undefined) {
      passkey.primary = true;
    }

    const { skipped } = new SsoGenerator(asFlow(written)).withProvider(slug("acme-sso"), {
      password: true,
      passkey: true,
    });
    const regions = skipped.map((entry) => {
      return entry.region;
    });

    expect(regions).toContain("steps.sso-conflict");
  });
});

describe("SsoGenerator.withoutProvider", () => {
  /**
   * The shipped flow after `auth-method sso enable` added these providers.
   *
   * @param slugs - The providers, in the order they were enabled.
   * @returns The flow.
   */
  function enabled(...slugs: string[]): Record<string, unknown> {
    return slugs.reduce((flow, name) => {
      return objectOf(new SsoGenerator(asFlow(flow)).withProvider(slug(name), bothMethods).document);
    }, shippedFlow());
  }

  it("does not change the flow it was given", () => {
    const flow = enabled("google");
    const copy = structuredClone(flow);

    new SsoGenerator(asFlow(flow)).withoutProvider("google");

    expect(flow).toEqual(copy);
  });

  it("takes the provider off every step that offered it", () => {
    const { document, changed } = new SsoGenerator(asFlow(enabled("google"))).withoutProvider("google");

    expect(changed).toBe(true);
    const offering = stepsOf(document).filter((step) => {
      return step.sso_providers !== undefined;
    });
    expect(offering).toEqual([]);
  });

  it.each(PRESETS)(
    "takes the provider off the password step of the %s flow, which enabling also offers it on",
    (preset) => {
      const flow = new SsoGenerator(asFlow(getDefaultLoginFlow({ preset }))).withProvider(
        slug("google"),
        bothMethods,
      ).document;
      expect(stepNamed(flow, "password").sso_providers).toEqual(["google"]);

      const { document } = new SsoGenerator(asFlow(flow)).withoutProvider("google");

      expect(stepNamed(document, "password").sso_providers).toBeUndefined();
    },
  );

  it("leaves the password step as enabling reads the shipped one, so enabling again edits it", () => {
    const { document } = new SsoGenerator(asFlow(enabled("google"))).withoutProvider("google");

    const again = new SsoGenerator(asFlow(document)).withProvider(slug("google"), bothMethods);

    expect(again.skipped).toEqual([]);
    expect(stepNamed(again.document, "password").sso_providers).toEqual(["google"]);
  });

  it("keeps the other providers on each step", () => {
    const { document } = new SsoGenerator(asFlow(enabled("google", "github"))).withoutProvider("google");

    expect(stepNamed(document, "identifier").sso_providers).toEqual(["github"]);
  });

  it("keeps the routes and steps sso enable added", () => {
    const before = enabled("google");

    const { document } = new SsoGenerator(asFlow(before)).withoutProvider("google");

    expect(targetsOf(document, "identifier")).toEqual(targetsOf(before, "identifier"));
    expect(stepNamed(document, "sso-conflict")).toBeDefined();
  });

  it("changes nothing for a provider the flow does not offer", () => {
    const flow = enabled("github");

    expect(new SsoGenerator(asFlow(flow)).withoutProvider("google")).toEqual({
      document: flow,
      changed: false,
      skipped: [],
    });
  });
});

describe.each([
  { name: "password and passkey", methods: { password: true, passkey: true } },
  {
    name: "passkey only, so the conflict step has no fields",
    methods: { password: false, passkey: true },
  },
])("a flow the server rewrote on apply, with $name", ({ methods }) => {
  /**
   * The shipped flow with Google enabled, as the server writes it back.
   *
   * @returns The flow.
   */
  function rewritten(): Record<string, unknown> {
    return serverCanonicalFlow(
      objectOf(new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), methods).document),
    );
  }

  it("reports no step as edited when another provider is added", () => {
    const { skipped } = new SsoGenerator(asFlow(rewritten())).withProvider(slug("acme-sso"), methods);

    expect(skipped).toEqual([]);
  });

  it("adds the provider to the conflict step", () => {
    const { document } = new SsoGenerator(asFlow(rewritten())).withProvider(slug("acme-sso"), methods);

    expect(stepNamed(document, "sso-conflict").sso_providers).toEqual(["google", "acme-sso"]);
  });

  it("adds the provider to the entry steps", () => {
    const { document } = new SsoGenerator(asFlow(rewritten())).withProvider(slug("acme-sso"), methods);

    expect(stepNamed(document, "identifier").sso_providers).toEqual(["google", "acme-sso"]);
  });
});

/**
 * Someone who signed up with a provider has no password. If they type their
 * email instead of clicking the button, the identifier step sends them to the
 * password step, which used to offer a password field and nothing else.
 */
describe("the password step", () => {
  /**
   * The shipped flow for a preset.
   *
   * @param preset - The preset.
   * @returns The flow.
   */
  function presetFlow(preset: SetupPreset): Record<string, unknown> {
    return objectOf(getDefaultLoginFlow({ preset }));
  }

  /**
   * The flow after one provider, as a document a developer could be holding.
   *
   * @param flow - The flow before the provider.
   * @returns The flow offering Google.
   */
  function enabled(flow: Record<string, unknown> = shippedFlow()): Record<string, unknown> {
    return objectOf(new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods).document);
  }

  /**
   * A copy of the enabled flow with one route on the password step replaced.
   *
   * @param outcome - The outcome whose route is replaced.
   * @param route - The route the developer wrote.
   * @returns The edited copy.
   */
  function withPasswordRoute(outcome: string, route: unknown): Record<string, unknown> {
    const edited = structuredClone(enabled());
    const password = stepNamed(edited, "password");
    password.transitions = { ...objectIn(password, "transitions"), [outcome]: route };
    return edited;
  }

  /**
   * Reword the password step's submit action, as a developer editing its copy
   * would.
   *
   * @param flow - The flow, changed in place.
   */
  function rewordPasswordSubmit(flow: Record<string, unknown>): void {
    const password = stepNamed(flow, "password");
    password.actions = [
      { name: "submit", kind: "submit", primary: true, text_key: "my.own.copy" },
      ...listIn(password, "actions").slice(1),
    ];
  }

  it("offers the provider, so a user without a password has a way in", () => {
    const { document, skipped } = new SsoGenerator(asFlow(shippedFlow())).withProvider(
      slug("google"),
      bothMethods,
    );

    expect(stepNamed(document, "password").sso_providers).toEqual(["google"]);
    expect(skipped).toEqual([]);
  });

  it("routes what comes back from the provider like the entry steps do", () => {
    const { document } = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);

    expect(targetsOf(document, "password")).toEqual({
      submit: "done",
      sso_authenticated: "done",
      sso_user_not_found: "register-sso",
      user_already_exists: "sso-conflict",
    });
  });

  it("keeps the password field and the sign-in action", () => {
    const before = stepNamed(shippedFlow(), "password");
    const after = stepNamed(enabled(), "password");

    expect(after.fields).toEqual(before.fields);
    expect(after.actions).toEqual(before.actions);
  });

  it("is recognised on the passkey-first preset too, and keeps its passkey action", () => {
    const { document, skipped } = new SsoGenerator(asFlow(presetFlow("passkey-first"))).withProvider(
      slug("google"),
      bothMethods,
    );

    expect(skipped).toEqual([]);
    expect(actionNames(stepNamed(document, "password"))).toEqual(["submit", "passkey"]);
  });

  it("gains every provider the entry steps carry", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const second = new SsoGenerator(asFlow(first.document)).withProvider(slug("acme-sso"), bothMethods);

    expect(stepNamed(second.document, "password").sso_providers).toEqual(["google", "acme-sso"]);
    expect(second.skipped).toEqual([]);
  });

  it("changes nothing when the same provider is enabled again", () => {
    const first = new SsoGenerator(asFlow(shippedFlow())).withProvider(slug("google"), bothMethods);
    const again = new SsoGenerator(asFlow(first.document)).withProvider(slug("google"), bothMethods);

    expect(again.changed).toBe(false);
    expect(again.document).toEqual(first.document);
  });

  describe("in a project enabled before the step offered providers", () => {
    /**
     * The enabled flow as it was before the password step offered providers.
     *
     * @returns The flow.
     */
    function older(): Record<string, unknown> {
      const flow = structuredClone(enabled());
      const password = stepNamed(flow, "password");
      delete password.sso_providers;
      password.transitions = { submit: { target: "done" } };
      return flow;
    }

    it("is caught up with the provider already on the entry steps", () => {
      const { document, changed } = new SsoGenerator(asFlow(older())).withProvider(
        slug("google"),
        bothMethods,
      );

      expect(changed).toBe(true);
      expect(stepNamed(document, "password").sso_providers).toEqual(["google"]);
    });

    it("is caught up with every provider the entry steps carry", () => {
      const { document } = new SsoGenerator(asFlow(older())).withProvider(slug("acme-sso"), bothMethods);

      expect(stepNamed(document, "password").sso_providers).toEqual(["google", "acme-sso"]);
    });
  });

  describe.each(PRESETS)("after the server rewrote the %s flow on apply", (preset) => {
    /**
     * The preset's flow with Google enabled, as the server writes it back.
     *
     * @returns The flow.
     */
    function rewritten(): Record<string, unknown> {
      return serverCanonicalFlow(enabled(presetFlow(preset)));
    }

    it("recognises every step it wrote, so none is reported as edited", () => {
      const { skipped } = new SsoGenerator(asFlow(rewritten())).withProvider(slug("acme-sso"), bothMethods);

      expect(skipped).toEqual([]);
    });

    it("adds the next provider to the password step", () => {
      const { document } = new SsoGenerator(asFlow(rewritten())).withProvider(
        slug("acme-sso"),
        bothMethods,
      );

      expect(stepNamed(document, "password").sso_providers).toEqual(["google", "acme-sso"]);
    });

    it("adds the next provider to the conflict step", () => {
      const { document } = new SsoGenerator(asFlow(rewritten())).withProvider(
        slug("acme-sso"),
        bothMethods,
      );

      expect(stepNamed(document, "sso-conflict").sso_providers).toEqual(["google", "acme-sso"]);
    });
  });

  describe("when the developer changed it", () => {
    /**
     * The shipped flow with the password step's copy reworded.
     *
     * @returns The flow.
     */
    function editedFlow(): Record<string, unknown> {
      const flow = shippedFlow();
      rewordPasswordSubmit(flow);
      return flow;
    }

    it("leaves the step exactly as it was", () => {
      const flow = editedFlow();
      const before = structuredClone(stepNamed(flow, "password"));

      const { document } = new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);

      expect(stepNamed(document, "password")).toEqual(before);
    });

    it("names the step it left, by name", () => {
      const { skipped } = new SsoGenerator(asFlow(editedFlow())).withProvider(slug("google"), bothMethods);

      expect(skipped).toEqual([
        { step: "password", region: "steps.password", reason: "hand-edited" },
      ]);
    });

    it("still offers the provider where the generator owns the step", () => {
      const { document } = new SsoGenerator(asFlow(editedFlow())).withProvider(slug("google"), bothMethods);

      expect(stepNamed(document, "identifier").sso_providers).toEqual(["google"]);
      expect(stepNamed(document, "register").sso_providers).toEqual(["google"]);
    });

    it("says nothing once the provider and its routes are there, however else it differs", () => {
      const flow = structuredClone(enabled());
      rewordPasswordSubmit(flow);

      const { skipped, changed } = new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);

      expect(skipped).toEqual([]);
      expect(changed).toBe(false);
    });

    it.each([
      ["user_already_exists", { target: "register" }],
      ["sso_authenticated", { target: "identifier" }],
      ["sso_user_not_found", { target: "register" }],
      ["sso_authenticated", { target: "done", purpose: "login" }],
    ])("does not take over a %s route the developer wrote as %j", (outcome, route) => {
      const { document, skipped } = new SsoGenerator(asFlow(
        withPasswordRoute(outcome, route),
      )).withProvider(slug("acme-sso"), bothMethods);
      const steps = skipped.map((entry) => {
        return entry.step;
      });

      expect(steps).toContain("password");
      expect(stepNamed(document, "password").transitions).toMatchObject({ [outcome]: route });
    });
  });

  it("says nothing about a flow that has no password step", () => {
    const flow = shippedFlow();
    flow.steps = stepsOf(flow).filter((step) => {
      return step.name !== "password";
    });

    const { skipped } = new SsoGenerator(asFlow(flow)).withProvider(slug("google"), bothMethods);
    const steps = skipped.map((entry) => {
      return entry.step;
    });

    expect(steps).not.toContain("password");
  });
});
