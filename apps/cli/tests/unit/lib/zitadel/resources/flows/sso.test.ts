import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { serverCanonicalFlow } from "@zitadel/api-mock";
import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";
import type { ConnectionSlug } from "@zitadel/config/idp";

import { RefusedEditError } from "@/lib/zitadel";
import { SsoGenerator } from "@/lib/zitadel/resources/flows/sso";
import type { JsonObject, JsonValue } from "@/lib/zitadel/types";
import {
  isJsonArray,
  isJsonObject,
  listAt,
  objectAt,
  toJsonObject,
} from "@/lib/zitadel/utils/json";
import {
  actionsIn,
  aFlow,
  aShippedLoginFlow,
  BOTH_METHODS,
  PASSKEY_ONLY,
  PASSWORD_ONLY,
  routesIn,
  stepNamesIn,
  stepsIn,
  withoutStep,
  withStep,
} from "@tests/helpers/flows";
import { slug } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The design's worked example: the shipped flow with Google added.
 */
const DESIGN_EXAMPLE = fileURLToPath(
  new URL(
    "../../../../../../../../docs/design/idp/schemas/default-login.scaffold.json",
    import.meta.url,
  ),
);

/**
 * The provider the tests enable first.
 */
const GOOGLE = slug("google");

/**
 * A second provider, enabled after {@link GOOGLE}.
 */
const GITHUB = slug("github");

/**
 * Another second provider, enabled after {@link GOOGLE}.
 */
const ACME = slug("acme-sso");

/**
 * The presets whose password step enabling a provider also edits.
 */
const PRESETS: readonly SetupPreset[] = ["passkey-first", "password-first"];

/**
 * The use cases a flow can be scaffolded for.
 */
const USE_CASES: readonly SetupUseCase[] = ["minimal", "consumer", "business"];

/**
 * The steps that offer every enabled provider once the shipped flow has one.
 */
const OFFERING_STEPS = ["identifier", "register", "password", "sso-conflict"];

/**
 * The entry steps a provider is offered on, and the conflict step.
 */
const GENERATED_OFFERING_STEPS = ["identifier", "register", "sso-conflict"];

/**
 * What the edit reports for a conflict step the developer changed.
 */
const HAND_EDITED_CONFLICT = {
  step: "sso-conflict",
  region: "steps.sso-conflict",
  reason: "hand-edited",
};

/**
 * The outcome keys the previous CLI wrote, by the name the engine now raises.
 */
const LEGACY_NAMES: Readonly<Record<string, string>> = {
  sso_authenticated: "callback",
  sso_user_not_found: "identity_unknown",
};

/**
 * The shipped login flow, scaffolded for the minimal use case.
 */
const SHIPPED = aShippedLoginFlow({ useCase: "minimal" });

/**
 * The shipped flow after Google was enabled for both methods.
 */
const ENABLED = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS).document;

/**
 * A flow that only registers. `auth-method sso enable` edits every flow bound
 * to the schema, and this one has nowhere to send someone who wants to sign
 * in: the validator rejects a transition that re-purposes to a purpose the
 * flow lacks.
 */
const REGISTER_ONLY = {
  name: "register-only",
  purposes: { register: "register" },
  steps: [
    { name: "register", fields: ["email"], actions: [], transitions: {} },
    { name: "done", complete: "show" },
  ],
};

/**
 * The design's worked example, as the file holds it.
 *
 * @returns The flow.
 * @throws {@link ConfigError} When the file does not hold an object.
 */
function designedFlow(): JsonObject {
  return toJsonObject(JSON.parse(readFileSync(DESIGN_EXAMPLE, "utf8")), DESIGN_EXAMPLE);
}

/**
 * A flow without its `$schema` pointer, which tells an editor where the
 * meta-schema is rather than what the flow does; the design's example points
 * somewhere other than the shipped flow.
 *
 * @param flow - The flow.
 * @returns The flow without the pointer.
 */
function withoutPointer(flow: JsonObject): JsonObject {
  const { $schema: _pointer, ...rest } = flow;
  return rest;
}

/**
 * A flow with these providers enabled for both methods, one after another.
 *
 * @param flow - The flow before any of them.
 * @param slugs - The providers, in the order they are enabled.
 * @returns The flow offering them.
 */
function enabled(flow: JsonObject, ...slugs: string[]): JsonObject {
  return slugs.reduce((current, name) => {
    return new SsoGenerator(aFlow(current)).withProvider(slug(name), BOTH_METHODS).document;
  }, flow);
}

/**
 * An object with its keys, and those of every object in it, sorted: the way a
 * managed file is written, so a flow that has been through `apply` comes back
 * in that order.
 *
 * @param object - The object.
 * @returns The same object, keys sorted.
 */
function keySorted(object: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .flatMap((key) => {
        const value = object[key];
        if (value === undefined) {
          return [];
        }
        return [[key, keySortedValue(value)]];
      }),
  );
}

/**
 * A JSON value with the keys of every object in it sorted.
 *
 * @param value - The value.
 * @returns The same value, keys sorted.
 */
function keySortedValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    return value.map(keySortedValue);
  }
  if (isJsonObject(value)) {
    return keySorted(value);
  }
  return value;
}

/**
 * A flow whose actions no longer say `primary: false`, which is the default:
 * what a real `apply` writes back.
 *
 * @param flow - The flow.
 * @returns The flow without those keys.
 */
function withoutDefaultPrimary(flow: JsonObject): JsonObject {
  return {
    ...flow,
    steps: listAt(flow, "steps").map((step) => {
      if (!isJsonObject(step)) {
        return step;
      }
      return {
        ...step,
        actions: listAt(step, "actions").map((action) => {
          if (!isJsonObject(action) || action.primary !== false) {
            return action;
          }
          const { primary: _default, ...rest } = action;
          return rest;
        }),
      };
    }),
  };
}

/**
 * A flow shaped like the shipped one, but ending somewhere else.
 *
 * @param terminal - The name of the step a completed sign-in ends at.
 * @returns The flow.
 */
function flowEndingAt(terminal: string): JsonObject {
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
function targetsIn(flow: JsonObject): readonly string[] {
  return Object.values(routesIn(flow)).flatMap((routes) => {
    return Object.values(routes);
  });
}

/**
 * The flow the previous CLI wrote: today's output, under the old outcome keys.
 *
 * @returns The flow.
 */
function previousCliFlow(): JsonObject {
  return {
    ...ENABLED,
    steps: listAt(ENABLED, "steps").map((step) => {
      if (!isJsonObject(step) || !isJsonObject(step.transitions)) {
        return step;
      }
      const transitions = Object.entries(step.transitions).map(([outcome, route]) => {
        return [LEGACY_NAMES[outcome] ?? outcome, route];
      });
      return { ...step, transitions: Object.fromEntries(transitions) };
    }),
  };
}

/**
 * The legacy outcome keys a flow still carries.
 *
 * @param flow - The flow.
 * @returns Each as `step.key`.
 */
function legacyKeysIn(flow: JsonObject): readonly string[] {
  const legacy = Object.values(LEGACY_NAMES);
  return Object.entries(routesIn(flow)).flatMap(([step, routes]) => {
    return Object.keys(routes)
      .filter((key) => {
        return legacy.includes(key);
      })
      .map((key) => {
        return `${step}.${key}`;
      });
  });
}

/**
 * A step with one more action, and its route when one is given.
 *
 * @param step - The step.
 * @param action - The action's name.
 * @param route - The route its transition takes, if it has one.
 * @returns The step.
 */
function withAction(step: JsonObject, action: string, route?: JsonObject): JsonObject {
  const actions = [...listAt(step, "actions"), { name: action, kind: "submit" }];
  if (route === undefined) {
    return { ...step, actions };
  }
  return { ...step, actions, transitions: { ...objectAt(step, "transitions"), [action]: route } };
}

/**
 * A step that asks for an email in place of what it asked for.
 *
 * @param step - The step.
 * @returns The step.
 */
function askingForEmail(step: JsonObject): JsonObject {
  return { ...step, fields: ["email"] };
}

/**
 * A flow whose password step's submit action carries the developer's own copy.
 *
 * @param flow - The flow.
 * @returns The flow.
 */
function rewordedPasswordSubmit(flow: JsonObject): JsonObject {
  return withStep(flow, "password", (step) => {
    return {
      ...step,
      actions: [
        { name: "submit", kind: "submit", primary: true, text_key: "my.own.copy" },
        ...listAt(step, "actions").slice(1),
      ],
    };
  });
}

/**
 * The enabled flow with one route on the password step replaced.
 *
 * @param outcome - The outcome whose route is replaced.
 * @param route - The route the developer wrote.
 * @returns The flow.
 */
function withPasswordRoute(outcome: string, route: JsonObject): JsonObject {
  return withStep(ENABLED, "password", (step) => {
    return { ...step, transitions: { ...objectAt(step, "transitions"), [outcome]: route } };
  });
}

/**
 * The enabled flow with its sign-in routed through an `mfa` step on the entry
 * steps, as a developer who wants a second factor after every provider return
 * would write it.
 *
 * @returns The flow.
 */
function withMfaAfterSso(): JsonObject {
  const mfa = {
    name: "mfa",
    fields: [],
    actions: [{ name: "submit", kind: "submit", primary: true, text_key: "mfa.action.submit" }],
    transitions: { submit: { target: "done" } },
  };
  const routed = ["identifier", "register"].reduce((flow, name) => {
    return withStep(flow, name, (step) => {
      return {
        ...step,
        transitions: { ...objectAt(step, "transitions"), sso_authenticated: { target: "mfa" } },
      };
    });
  }, ENABLED);
  return { ...routed, steps: [...listAt(routed, "steps"), mfa] };
}

/**
 * The enabled flow as it was before the password step offered providers: the
 * password step as shipped.
 *
 * @returns The flow.
 */
function beforePasswordOffered(): JsonObject {
  return withStep(ENABLED, "password", () => {
    return stepsIn(SHIPPED).password ?? {};
  });
}

/**
 * The previous CLI's flow with a step `sso enable` does not write, carrying
 * both a legacy outcome and an action named after the outcome it is renamed to.
 *
 * @param old - The legacy outcome.
 * @param next - The name it is renamed to, which the action also has.
 * @returns The flow.
 */
function withCustomCollision(old: string, next: string): JsonObject {
  const flow = previousCliFlow();
  const custom = {
    name: "custom",
    fields: ["email"],
    actions: [{ name: next, kind: "submit" }],
    transitions: { [old]: { target: "done" }, [next]: { target: "register" } },
  };
  return { ...flow, steps: [...listAt(flow, "steps"), custom] };
}

/**
 * The previous CLI's flow with its register step's legacy `callback` outcome
 * declaring more than a target, which was legal before the rename.
 *
 * @param declared - What the outcome declares besides its target.
 * @returns The flow.
 */
function withDeclaringCallback(declared: JsonObject): JsonObject {
  return withStep(previousCliFlow(), "register", (step) => {
    const transitions = objectAt(step, "transitions");
    return {
      ...step,
      transitions: {
        ...transitions,
        callback: { ...objectAt(transitions, "callback"), ...declared },
      },
    };
  });
}

/**
 * A flow carrying an action the edit would collide with, and what the edit
 * says when it refuses it.
 */
type Collision = Readonly<{
  /**
   * What the case is.
   */
  name: string;
  /**
   * The flow.
   */
  flow: JsonObject;
  /**
   * The provider the edit enables.
   */
  provider: ConnectionSlug;
  /**
   * The refusal's message.
   */
  message: string;
}>;

/**
 * The flows a provider edit refuses because an action and an outcome would
 * share a name: renaming or writing the outcome would hand the action's route
 * to the generated target without saying so, and dropping what a legacy
 * outcome declares would change where its author routed it.
 */
const COLLISIONS: readonly Collision[] = [
  {
    name: "an action already named after the outcome a legacy key is renamed to",
    flow: withStep(previousCliFlow(), "identifier", (step) => {
      return withAction(step, "sso_authenticated");
    }),
    provider: GITHUB,
    message:
      'steps.identifier: action "sso_authenticated" uses a name auth-method sso enable writes as an outcome on this step',
  },
  {
    name: "callback renamed onto an action on a step sso enable does not write",
    flow: withCustomCollision("callback", "sso_authenticated"),
    provider: GITHUB,
    message:
      'steps.custom: transition "callback" is renamed to "sso_authenticated", which is an action on this step',
  },
  {
    name: "identity_unknown renamed onto an action on a step sso enable does not write",
    flow: withCustomCollision("identity_unknown", "sso_user_not_found"),
    provider: GITHUB,
    message:
      'steps.custom: transition "identity_unknown" is renamed to "sso_user_not_found", which is an action on this step',
  },
  {
    name: "a legacy outcome that declares a purpose",
    flow: withDeclaringCallback({ purpose: "register" }),
    provider: GITHUB,
    message:
      'steps.register: transition "callback" declares purpose or action, which "sso_authenticated" cannot',
  },
  {
    name: "a legacy outcome that declares an action",
    flow: withDeclaringCallback({ action: "switch" }),
    provider: GITHUB,
    message:
      'steps.register: transition "callback" declares purpose or action, which "sso_authenticated" cannot',
  },
  {
    name: "an action named after a generated outcome on a flow with no legacy keys",
    flow: withStep(SHIPPED, "identifier", (step) => {
      return withAction(step, "sso_authenticated", { target: "register" });
    }),
    provider: GOOGLE,
    message:
      'steps.identifier: action "sso_authenticated" uses a name auth-method sso enable writes as an outcome on this step',
  },
  {
    name: "an action named after a generated outcome on a login entry named register-password",
    flow: {
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
    },
    provider: GOOGLE,
    message:
      'steps.register-password: action "sso_authenticated" uses a name auth-method sso enable writes as an outcome on this step',
  },
];

describe("SsoGenerator.withProvider", () => {
  describe("with the shipped flow", () => {
    it("produces the flow the design documents", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(withoutPointer(document)).toEqual(withoutPointer(designedFlow()));
    });

    it.each(["identifier", "register", "password"])(
      "offers the provider on the %s step",
      (step) => {
        const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

        expect(stepsIn(document)[step]?.sso_providers).toEqual(["google"]);
      },
    );

    it("offers no provider on the step that collects what the provider missed", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["register-sso"]).not.toHaveProperty("sso_providers");
    });

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it("routes each outcome a provider return can produce from the identifier step", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(routesIn(document).identifier).toEqual({
        submit: "password",
        register: "",
        user_not_found: "register",
        sso_authenticated: "done",
        sso_user_not_found: "register-sso",
        user_already_exists: "sso-conflict",
      });
    });

    it("routes what comes back from the provider to the password step like the entry steps do", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(routesIn(document).password).toEqual({
        submit: "done",
        sso_authenticated: "done",
        sso_user_not_found: "register-sso",
        user_already_exists: "sso-conflict",
      });
    });

    it.each(["register", "register-password", "sso-conflict"])(
      "sends a colliding account from the %s step to the conflict step",
      (step) => {
        const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

        expect(routesIn(document)[step]?.user_already_exists).toBe("sso-conflict");
      },
    );

    it("raises no sso_user_already_exists outcome on the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(routesIn(document)["sso-conflict"]).not.toHaveProperty("sso_user_already_exists");
    });

    it.each(["fields", "actions"])("keeps the password step's %s", (key) => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document).password?.[key]).toEqual(stepsIn(SHIPPED).password?.[key]);
    });

    it.each(["register-sso", "sso-conflict"])(
      "adds the %s step before the terminal step",
      (step) => {
        const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, BOTH_METHODS);

        expect(stepNamesIn(document).indexOf(step)).toBeLessThan(
          stepNamesIn(document).indexOf("done"),
        );
      },
    );
  });

  describe("with a schema that enables only passkey", () => {
    it("asks for no field on the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSKEY_ONLY);

      expect(stepsIn(document)["sso-conflict"]?.fields).toEqual([]);
    });

    it("offers only the passkey and sign-in actions on the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSKEY_ONLY);

      expect(actionsIn(document)["sso-conflict"]).toEqual(["passkey", "sign_in"]);
    });

    it("routes no submit from the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSKEY_ONLY);

      expect(routesIn(document)["sso-conflict"]).not.toHaveProperty("submit");
    });
  });

  describe("with the passkey-first preset", () => {
    const passkeyFirst = aShippedLoginFlow({ useCase: "minimal", preset: "passkey-first" });

    it("sends the conflict step's sign-in back to the flow's own login entry", () => {
      const { document } = new SsoGenerator(aFlow(passkeyFirst)).withProvider(GOOGLE, BOTH_METHODS);

      expect(routesIn(document)["sso-conflict"]?.sign_in).toBe("passkey-first");
    });

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(passkeyFirst)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it("keeps the password step's passkey action", () => {
      const { document } = new SsoGenerator(aFlow(passkeyFirst)).withProvider(GOOGLE, BOTH_METHODS);

      expect(actionsIn(document).password).toEqual(["submit", "passkey"]);
    });
  });

  describe("with a flow that does not serve login", () => {
    it("routes no sign-in from the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(REGISTER_ONLY)).withProvider(
        GOOGLE,
        BOTH_METHODS,
      );

      expect(routesIn(document)["sso-conflict"]).not.toHaveProperty("sign_in");
    });

    it("offers no sign-in action on the conflict step", () => {
      const { document } = new SsoGenerator(aFlow(REGISTER_ONLY)).withProvider(
        GOOGLE,
        BOTH_METHODS,
      );

      expect(actionsIn(document)["sso-conflict"]).not.toContain("sign_in");
    });
  });

  describe("with the use case a flow was scaffolded for", () => {
    /**
     * Each use case, and the fields its `register-sso` step asks for. A
     * provider is not obliged to supply any of these, and the engine shows
     * the step precisely when the claims did not satisfy the schema, so it
     * asks for whatever registration asks for.
     */
    const EXPECTED_FIELDS: ReadonlyArray<readonly [SetupUseCase, readonly string[]]> = [
      ["minimal", ["email"]],
      ["consumer", ["email", "givenName", "familyName"]],
      ["business", ["email", "givenName", "familyName", "companyName"]],
    ];

    it.each(EXPECTED_FIELDS)(
      "asks register-sso for what the %s use case registers",
      (useCase, expected) => {
        const flow = aShippedLoginFlow({ useCase });

        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(stepsIn(document)["register-sso"]?.fields).toEqual(expected);
      },
    );

    it.each(USE_CASES)("asks register-sso for no credential in the %s use case", (useCase) => {
      const flow = aShippedLoginFlow({ useCase });

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["register-sso"]?.fields).not.toContainEqual(
        expect.stringMatching(/^x-auth-methods#/),
      );
    });
  });

  describe("with a register step that asks for less than the schema", () => {
    it("asks register-sso for what the register step asks for", () => {
      const flow = withStep(aShippedLoginFlow({ useCase: "business" }), "register", (step) => {
        return { ...step, fields: ["email", "givenName"] };
      });

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["register-sso"]?.fields).toEqual(["email", "givenName"]);
    });
  });

  describe("with a flow whose terminal is not called done", () => {
    it("points the generated routes at the flow's own terminal", () => {
      const flow = flowEndingAt("complete");

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, PASSWORD_ONLY);

      expect(targetsIn(document)).toContain("complete");
    });

    it("points no route at a done step the flow lacks", () => {
      const flow = flowEndingAt("complete");

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, PASSWORD_ONLY);

      expect(targetsIn(document)).not.toContain("done");
    });

    it("points every transition at a step the flow has", () => {
      const flow = flowEndingAt("finished");

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, PASSKEY_ONLY);

      expect(stepNamesIn(document)).toEqual(expect.arrayContaining([...targetsIn(document)]));
    });
  });

  describe("with a flow whose terminal is called done", () => {
    it("points the generated routes at done", () => {
      const flow = flowEndingAt("done");

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, PASSWORD_ONLY);

      expect(targetsIn(document)).toContain("done");
    });
  });

  describe("with a flow that has no conflict step yet", () => {
    it("offers the provider on the conflict step it writes", () => {
      const flow = flowEndingAt("done");

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["sso-conflict"]?.sso_providers).toEqual(["google"]);
    });

    it("reports no step as hand-edited", () => {
      const flow = flowEndingAt("done");

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });
  });

  describe("with a flow that has no password step", () => {
    it("does not name a password step as left alone", () => {
      const flow = withoutStep(SHIPPED, "password");

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).not.toContainEqual(expect.objectContaining({ step: "password" }));
    });
  });

  describe("when the provider was enabled before", () => {
    it("returns the flow as it was", () => {
      const edit = new SsoGenerator(aFlow(ENABLED)).withProvider(GOOGLE, BOTH_METHODS);

      expect(edit).toEqual({ document: ENABLED, changed: false, skipped: [] });
    });
  });

  describe("when another provider was enabled before", () => {
    it.each(OFFERING_STEPS)("offers both providers on the %s step", (step) => {
      const { document } = new SsoGenerator(aFlow(ENABLED)).withProvider(GITHUB, BOTH_METHODS);

      expect(stepsIn(document)[step]?.sso_providers).toEqual(["google", "github"]);
    });

    it("says it changed the flow", () => {
      const { changed } = new SsoGenerator(aFlow(ENABLED)).withProvider(GITHUB, BOTH_METHODS);

      expect(changed).toBe(true);
    });

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(ENABLED)).withProvider(GITHUB, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });
  });

  describe("when the file was written back with its keys sorted", () => {
    it("reports no step as hand-edited", () => {
      const flow = keySorted(ENABLED);

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });
  });

  describe("when the file was written back without the default primary: false", () => {
    it("reports no step as hand-edited", () => {
      const flow = withoutDefaultPrimary(ENABLED);

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it("offers the next provider on the conflict step", () => {
      const flow = withoutDefaultPrimary(ENABLED);

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document)["sso-conflict"]?.sso_providers).toEqual(["google", "acme-sso"]);
    });

    it("still reports a conflict step whose passkey action was made primary", () => {
      const flow = withStep(withoutDefaultPrimary(ENABLED), "sso-conflict", (step) => {
        return {
          ...step,
          actions: listAt(step, "actions").map((action) => {
            if (!isJsonObject(action) || action.name !== "passkey") {
              return action;
            }
            return { ...action, primary: true };
          }),
        };
      });

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(skipped).toContainEqual(HAND_EDITED_CONFLICT);
    });
  });

  describe.each([
    { name: "password and passkey", methods: BOTH_METHODS },
    { name: "passkey only, so the conflict step has no fields", methods: PASSKEY_ONLY },
  ])("when the server rewrote the flow on apply, enabling $name", ({ methods }) => {
    const rewritten = toJsonObject(
      serverCanonicalFlow(new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, methods).document),
      "the flow the server rewrote",
    );

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(rewritten)).withProvider(ACME, methods);

      expect(skipped).toEqual([]);
    });

    it.each(["identifier", "sso-conflict"])("offers the next provider on the %s step", (step) => {
      const { document } = new SsoGenerator(aFlow(rewritten)).withProvider(ACME, methods);

      expect(stepsIn(document)[step]?.sso_providers).toEqual(["google", "acme-sso"]);
    });
  });

  describe.each(PRESETS)("when the server rewrote the %s flow on apply", (preset) => {
    const rewritten = toJsonObject(
      serverCanonicalFlow(enabled(aShippedLoginFlow({ preset }), "google")),
      "the flow the server rewrote",
    );

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(rewritten)).withProvider(ACME, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it.each(["password", "sso-conflict"])("offers the next provider on the %s step", (step) => {
      const { document } = new SsoGenerator(aFlow(rewritten)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document)[step]?.sso_providers).toEqual(["google", "acme-sso"]);
    });
  });

  describe("when the provider was enabled for other methods", () => {
    it.each([
      { from: { password: true, passkey: false }, to: { password: true, passkey: true } },
      { from: { password: true, passkey: true }, to: { password: false, passkey: true } },
      { from: { password: false, passkey: false }, to: { password: true, passkey: false } },
      { from: { password: false, passkey: true }, to: { password: true, passkey: true } },
    ])("brings the conflict step it wrote for $from up to date for $to", ({ from, to }) => {
      const flow = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, from).document;
      const fresh = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, to).document;

      const edit = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, to);

      expect(edit).toMatchObject({
        changed: true,
        skipped: [],
        document: { steps: expect.arrayContaining([stepsIn(fresh)["sso-conflict"]]) },
      });
    });

    it("keeps every step where it was", () => {
      const flow = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSWORD_ONLY).document;

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

      expect(stepNamesIn(document)).toEqual(stepNamesIn(flow));
    });

    it("keeps the earlier provider on the conflict step", () => {
      const flow = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSWORD_ONLY).document;

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

      expect(stepsIn(document)["sso-conflict"]?.sso_providers).toEqual(["google", "github"]);
    });

    it("leaves a conflict step that matches no combination of methods as it was", () => {
      const written = new SsoGenerator(aFlow(SHIPPED)).withProvider(GOOGLE, PASSWORD_ONLY).document;
      const flow = withStep(written, "sso-conflict", askingForEmail);

      const edit = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(edit).toEqual({ document: flow, changed: false, skipped: [HAND_EDITED_CONFLICT] });
    });
  });

  describe("when the developer edited the conflict step", () => {
    const flow = withStep(ENABLED, "sso-conflict", askingForEmail);

    it("names the step it left alone", () => {
      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([HAND_EDITED_CONFLICT]);
    });

    it("keeps the step's fields", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["sso-conflict"]?.fields).toEqual(["email"]);
    });
  });

  describe("when the developer edited a conflict step that offers another provider", () => {
    /**
     * A flow whose conflict step lost the passkey action the generator writes
     * and offers only GitHub.
     */
    const flow = {
      name: "custom",
      status: "active",
      user_schema: "https://example.test/u.json",
      purposes: { login: "identifier" },
      steps: [
        { name: "identifier", fields: ["email"], transitions: { submit: { target: "done" } } },
        {
          name: "sso-conflict",
          fields: ["x-auth-methods#password"],
          actions: [{ name: "submit", kind: "submit", primary: true, text_key: "x" }],
          sso_providers: ["github"],
          transitions: { submit: { target: "done" } },
        },
        { name: "done", complete: "show" },
      ],
    };

    it("names the step it left alone", () => {
      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toContainEqual(HAND_EDITED_CONFLICT);
    });

    it("leaves the step's provider list as it was", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)["sso-conflict"]?.sso_providers).toEqual(["github"]);
    });
  });

  describe("when the developer edited the password step", () => {
    const flow = rewordedPasswordSubmit(SHIPPED);

    it("leaves the step as it was", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document).password).toEqual(stepsIn(flow).password);
    });

    it("names the step it left alone", () => {
      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([
        { step: "password", region: "steps.password", reason: "hand-edited" },
      ]);
    });

    it.each(["identifier", "register"])("still offers the provider on the %s step", (step) => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document)[step]?.sso_providers).toEqual(["google"]);
    });

    it("returns the flow as it was once the provider and its routes are there", () => {
      const offered = rewordedPasswordSubmit(ENABLED);

      const edit = new SsoGenerator(aFlow(offered)).withProvider(GOOGLE, BOTH_METHODS);

      expect(edit).toEqual({ document: offered, changed: false, skipped: [] });
    });

    describe.each([
      { outcome: "user_already_exists", route: { target: "register" } },
      { outcome: "sso_authenticated", route: { target: "identifier" } },
      { outcome: "sso_user_not_found", route: { target: "register" } },
      { outcome: "sso_authenticated", route: { target: "done", purpose: "login" } },
    ])("with its own $outcome route $route", ({ outcome, route }) => {
      it("names the step it left alone", () => {
        const routed = withPasswordRoute(outcome, route);

        const { skipped } = new SsoGenerator(aFlow(routed)).withProvider(ACME, BOTH_METHODS);

        expect(skipped).toContainEqual(expect.objectContaining({ step: "password" }));
      });

      it("keeps the route", () => {
        const routed = withPasswordRoute(outcome, route);

        const { document } = new SsoGenerator(aFlow(routed)).withProvider(ACME, BOTH_METHODS);

        expect(stepsIn(document).password?.transitions).toMatchObject({ [outcome]: route });
      });
    });
  });

  describe("when the developer routed a provider return through an mfa step", () => {
    const flow = withMfaAfterSso();

    it.each(["identifier", "register"])("keeps the sso_authenticated route on %s", (step) => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document)[step]?.transitions).toMatchObject({
        sso_authenticated: { target: "mfa" },
      });
    });

    it.each(["identifier", "register"])("names the %s step it left alone", (step) => {
      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(skipped).toContainEqual({ step, region: `steps.${step}`, reason: "hand-edited" });
    });

    it("still offers the provider on the step", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document).identifier?.sso_providers).toEqual(["google", "acme-sso"]);
    });

    it("keeps the other routes the generator writes", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document).identifier?.transitions).toMatchObject({
        sso_user_not_found: { target: "register-sso" },
        user_already_exists: { target: "sso-conflict" },
      });
    });

    it("keeps a sso_user_not_found route of its own", () => {
      const routed = withStep(flow, "identifier", (step) => {
        return {
          ...step,
          transitions: { ...objectAt(step, "transitions"), sso_user_not_found: { target: "mfa" } },
        };
      });

      const { document } = new SsoGenerator(aFlow(routed)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document).identifier?.transitions).toMatchObject({
        sso_user_not_found: { target: "mfa" },
      });
    });

    it("still retargets a user_already_exists route", () => {
      const routed = withStep(flow, "identifier", (step) => {
        return {
          ...step,
          transitions: { ...objectAt(step, "transitions"), user_already_exists: { target: "mfa" } },
        };
      });

      const { document } = new SsoGenerator(aFlow(routed)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document).identifier?.transitions).toMatchObject({
        user_already_exists: { target: "sso-conflict" },
      });
    });
  });

  describe("when the provider was enabled before the password step offered providers", () => {
    it("says it changed the flow", () => {
      const flow = beforePasswordOffered();

      const { changed } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(changed).toBe(true);
    });

    it("catches the password step up with the provider", () => {
      const flow = beforePasswordOffered();

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document).password?.sso_providers).toEqual(["google"]);
    });

    it("catches the password step up with every provider the entry steps carry", () => {
      const flow = beforePasswordOffered();

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(ACME, BOTH_METHODS);

      expect(stepsIn(document).password?.sso_providers).toEqual(["google", "acme-sso"]);
    });
  });

  describe("with a flow the previous CLI wrote", () => {
    it("leaves no legacy outcome key", () => {
      const flow = previousCliFlow();

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

      expect(legacyKeysIn(document)).toEqual([]);
    });

    it("reports no step as hand-edited", () => {
      const flow = previousCliFlow();

      const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it.each(GENERATED_OFFERING_STEPS)("offers both providers on the %s step", (step) => {
      const flow = previousCliFlow();

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

      expect(stepsIn(document)[step]?.sso_providers).toEqual(["google", "github"]);
    });

    it.each(GENERATED_OFFERING_STEPS)(
      "routes the %s step's provider outcomes under their new names",
      (step) => {
        const flow = previousCliFlow();

        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GITHUB, BOTH_METHODS);

        expect(routesIn(document)[step]).toMatchObject({
          sso_authenticated: "done",
          sso_user_not_found: "register-sso",
        });
      },
    );

    it("keeps the new key when a step carries both the old and the new one", () => {
      const flow = withStep(previousCliFlow(), "identifier", (step) => {
        return {
          ...step,
          transitions: {
            ...objectAt(step, "transitions"),
            sso_authenticated: { target: "register" },
          },
        };
      });

      const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

      expect(routesIn(document).identifier).not.toHaveProperty("callback");
    });

    describe("with an action named callback, as a legacy outcome was", () => {
      const flow = withStep(previousCliFlow(), "register", (step) => {
        return withAction(step, "callback");
      });

      it("keeps the action's own route", () => {
        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(stepsIn(document).register?.transitions).toMatchObject({
          callback: { target: "done" },
        });
      });

      it("renames the legacy outcome on every other step", () => {
        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(legacyKeysIn(document)).toEqual(["register.callback"]);
      });
    });

    describe("when the developer edited its conflict step", () => {
      const flow = withStep(previousCliFlow(), "sso-conflict", askingForEmail);

      it("names the step it left alone", () => {
        const { skipped } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(skipped).toEqual([HAND_EDITED_CONFLICT]);
      });

      it("keeps the step's fields", () => {
        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(stepsIn(document)["sso-conflict"]?.fields).toEqual(["email"]);
      });

      it("leaves no legacy outcome key", () => {
        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(legacyKeysIn(document)).toEqual([]);
      });

      it("routes the step's provider return under its new name", () => {
        const { document } = new SsoGenerator(aFlow(flow)).withProvider(GOOGLE, BOTH_METHODS);

        expect(routesIn(document)["sso-conflict"]?.sso_authenticated).toBe("done");
      });
    });
  });

  describe("when an action shares its name with an outcome the edit writes", () => {
    it.each(COLLISIONS)("refuses $name", ({ flow, provider, message }) => {
      const error = thrownBy(() => {
        return new SsoGenerator(aFlow(flow)).withProvider(provider, BOTH_METHODS);
      });

      expect(error).toBeInstanceOf(RefusedEditError);
      expect(error).toMatchObject({ message });
    });

    it.each(COLLISIONS)("leaves the flow it refuses as it was: $name", ({ flow, provider }) => {
      const before = structuredClone(flow);

      thrownBy(() => {
        return new SsoGenerator(aFlow(flow)).withProvider(provider, BOTH_METHODS);
      });

      expect(flow).toEqual(before);
    });
  });
});

describe("SsoGenerator.withoutProvider", () => {
  it("does not change the flow it was given", () => {
    const flow = enabled(SHIPPED, "google");
    const before = structuredClone(flow);

    new SsoGenerator(aFlow(flow)).withoutProvider("google");

    expect(flow).toEqual(before);
  });

  it("says it changed the flow", () => {
    const { changed } = new SsoGenerator(aFlow(ENABLED)).withoutProvider("google");

    expect(changed).toBe(true);
  });

  it("takes the provider off every step that offered it", () => {
    const { document } = new SsoGenerator(aFlow(ENABLED)).withoutProvider("google");

    expect(Object.values(stepsIn(document))).not.toContainEqual(
      expect.objectContaining({ sso_providers: expect.anything() }),
    );
  });

  it.each(PRESETS)("takes the provider off the password step of the %s flow", (preset) => {
    const flow = enabled(aShippedLoginFlow({ preset }), "google");

    const { document } = new SsoGenerator(aFlow(flow)).withoutProvider("google");

    expect(stepsIn(document).password).not.toHaveProperty("sso_providers");
  });

  it("keeps the other providers on each step", () => {
    const flow = enabled(SHIPPED, "google", "github");

    const { document } = new SsoGenerator(aFlow(flow)).withoutProvider("google");

    expect(stepsIn(document).identifier?.sso_providers).toEqual(["github"]);
  });

  it("keeps the routes sso enable added", () => {
    const { document } = new SsoGenerator(aFlow(ENABLED)).withoutProvider("google");

    expect(routesIn(document).identifier).toEqual(routesIn(ENABLED).identifier);
  });

  it("keeps the steps sso enable added", () => {
    const { document } = new SsoGenerator(aFlow(ENABLED)).withoutProvider("google");

    expect(stepNamesIn(document)).toContain("sso-conflict");
  });

  it("returns the flow as it was for a provider the flow does not offer", () => {
    const flow = enabled(SHIPPED, "github");

    const edit = new SsoGenerator(aFlow(flow)).withoutProvider("google");

    expect(edit).toEqual({ document: flow, changed: false, skipped: [] });
  });

  describe("when the developer routed a provider return through an mfa step", () => {
    const flow = withMfaAfterSso();

    it("keeps the route", () => {
      const { document } = new SsoGenerator(aFlow(flow)).withoutProvider("google");

      expect(stepsIn(document).identifier?.transitions).toMatchObject({
        sso_authenticated: { target: "mfa" },
      });
    });

    it("reports nothing as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(flow)).withoutProvider("google");

      expect(skipped).toEqual([]);
    });
  });

  describe("when the provider is enabled again", () => {
    const { document: disabled } = new SsoGenerator(aFlow(ENABLED)).withoutProvider("google");

    it("reports no step as hand-edited", () => {
      const { skipped } = new SsoGenerator(aFlow(disabled)).withProvider(GOOGLE, BOTH_METHODS);

      expect(skipped).toEqual([]);
    });

    it("offers it on the password step again", () => {
      const { document } = new SsoGenerator(aFlow(disabled)).withProvider(GOOGLE, BOTH_METHODS);

      expect(stepsIn(document).password?.sso_providers).toEqual(["google"]);
    });
  });
});

describe("SsoGenerator.editRefusal", () => {
  it.each([
    { name: "the shipped flow", flow: aShippedLoginFlow() },
    {
      name: "a flow with only its terminal step",
      flow: { steps: [{ name: "done", complete: "show" }] },
    },
  ])("is undefined for $name", ({ flow }) => {
    const refusal = new SsoGenerator(aFlow(flow)).editRefusal;

    expect(refusal).toBeUndefined();
  });

  it("says no step marks where a sign-in ends for a flow without a terminal step", () => {
    const flow = aFlow({ steps: [{ name: "identifier" }] });

    const said = new SsoGenerator(flow).editRefusal;

    expect(said).toBe("no step marks where a completed sign-in ends");
  });
});
